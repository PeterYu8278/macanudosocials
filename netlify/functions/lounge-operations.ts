import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { getFirestore } from './_shared/firestoreMonitoring';
import { toWebFunction, type EventHandler } from './_shared/webFunction';
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections';
import { validateLoungeOperations } from '../../src/utils/loungeOperations';
import { authorizeLounge, checkInLounge, deductLoungeRealtime, loungeError, settleLoungeVisit, syncLoungeRedemptions } from './_shared/loungeVisits';
import { previewLoungeClosing } from './_shared/loungeClosing';
import { dispatchLoungeClosing } from './_shared/loungeDispatch';
import { localBusinessDate, businessCutoff } from '../../src/utils/loungeOperations';
import { loadLoungeReportTransport } from './_shared/loungeReportTransport';
import { executeLoungeTestReport } from './_shared/loungeTestReport';
import { saveWalletDebtBaseline } from './_shared/walletDebtBaseline';
import { correctLegacyLoungeDebtDetails } from '../../src/utils/legacyLoungeReportSnapshot';

const validId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,160}$/.test(value);
const reply = (statusCode: number, data: object) => ({ statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) });
export const eventHandler: EventHandler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, { success: false, code: 'invalid-request' });
  try {
    const token = (event.headers.authorization || event.headers.Authorization || '').match(/^Bearer (.+)$/)?.[1];
    if (!token) return reply(401, { success: false, code: 'auth-required' });
    if (!event.body || event.body.length > 16000) throw loungeError('invalid-request');
    let input: any;
    try { input = JSON.parse(event.body); } catch { throw loungeError('invalid-request'); }
    if (!input || !validId(input.storeId)) throw loungeError('invalid-request');
    if (!getApps().length) {
      const credentials = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!credentials) throw loungeError('service-unavailable');
      initializeApp({ credential: cert(JSON.parse(credentials)) });
    }
    const { uid } = await getAuth().verifyIdToken(token, true), db = getFirestore(), now = new Date();
    if (input.action === 'save-debt-baseline') return reply(200, { success: true, ...await saveWalletDebtBaseline(db, uid, input) });
    if (input.action === 'debt-baseline') {
      if (!validId(input.userId)) throw loungeError('invalid-request');
      // Editing a global wallet baseline is restricted independently of lounge report access.
      const actor = await db.runTransaction(async tx => authorizeLounge(tx, db, uid, uid, input.storeId, true));
      if (!['superAdmin', 'developer'].includes(actor.role) || actor.status === 'suspended') throw loungeError('forbidden');
      const baseline = (await db.collection(C.WALLET_DEBT_BASELINES).doc(input.userId).get()).data();
      return reply(200, { success: true, baseline: baseline || null });
    }
    if (['test-report-preview', 'test-report-send', 'test-report-status'].includes(input.action)) {
      return reply(200, { success: true, ...await executeLoungeTestReport(db, uid, input) });
    }
    if (['save-hours', 'status', 'preview', 'retry', 'report-details'].includes(input.action)) {
      // Administrators configure operations; ordinary staff only check in/out at their lounge.
      await db.runTransaction(async tx => { await authorizeLounge(tx, db, uid, uid, input.storeId, true); });
      if (input.action === 'report-details') {
        if (!validId(input.reportId) || !['test', 'formal'].includes(input.reportKind)) throw loungeError('invalid-request');
        const report = (await db.collection(input.reportKind === 'test' ? C.LOUNGE_TEST_REPORTS : C.LOUNGE_REPORTS).doc(input.reportId).get()).data();
        if (!report || report.storeId !== input.storeId) throw loungeError('report-not-found');
        return reply(200, { success: true, debtDetails: report.debtDetails
          ? correctLegacyLoungeDebtDetails(report.debtDetails) : null });
      }
      if (input.action === 'status') {
        const batches = await db.collection(C.LOUNGE_BATCHES).where('storeId', '==', input.storeId).get();
        const rows: any[] = batches.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => b.businessDate.localeCompare(a.businessDate)).slice(0, 14);
        for (const row of rows) {
          const report = (await db.collection(C.LOUNGE_REPORTS).doc(`${input.storeId}_${row.businessDate}_v${row.revision || 1}`).get()).data();
          row.reportStatus = report?.delivery?.status || 'not-sent'; row.reportText = report?.text || '';
          const task = (await db.collection(C.WHATSAPP_TASKS).doc(report?.delivery?.taskId || `lounge-${input.storeId}_${row.businessDate}_v${row.revision || 1}`).get()).data();
          if (task) row.reportStatus = task.status;
        }
        return reply(200, { success: true, enabled: process.env.LOUNGE_OPERATIONS_ENABLED === 'true',
          batches: rows });
      }
      if (input.action === 'save-hours') {
        validateLoungeOperations(input.operations);
        if (input.operations.enabled && (process.env.LOUNGE_OPERATIONS_ENABLED !== 'true'
          || (process.env.LOUNGE_JOB_SECRET || '').length < 32 || !process.env.URL)) throw loungeError('not-ready');
        const reportTransport = input.operations.dailyReportEnabled ? await loadLoungeReportTransport(db, input.operations) : null;
        await db.runTransaction(async tx => {
          await authorizeLounge(tx, db, uid, uid, input.storeId, true);
          const ref = db.collection(C.STORES).doc(input.storeId), old = await tx.get(ref);
          if (!old.exists) throw loungeError('lounge-unavailable');
          const active = await tx.get(db.collection(C.VISIT_SESSIONS).where('storeId', '==', input.storeId).where('status', '==', 'pending').limit(1));
          if (active.size && !!old.data()?.operations?.enabled !== input.operations.enabled) throw loungeError('active-visits');
          if (reportTransport) await reportTransport.assert(tx, input.operations);
          tx.update(ref, { operations: input.operations, updatedAt: Timestamp.now() });
          tx.create(db.collection(C.AUDIT_LOGS).doc(), { action: 'lounge-hours', storeId: input.storeId, operatorId: uid,
            before: old.data()?.operations || null, after: input.operations, createdAt: Timestamp.now() });
        });
        return reply(200, { success: true });
      }
      if (input.action === 'preview') return reply(200, { success: true, ...await previewLoungeClosing(db, input.storeId, now) });
      if (process.env.LOUNGE_OPERATIONS_ENABLED !== 'true') throw loungeError('not-ready');
      const date = input.businessDate || localBusinessDate(now);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(businessCutoff(date).getTime()) || now < businessCutoff(date)) throw loungeError('before-closing');
      return reply(200, { success: true, ...await dispatchLoungeClosing(input.storeId, date, true) });
    }
    if (process.env.LOUNGE_OPERATIONS_ENABLED !== 'true') throw loungeError('not-ready');
    if (input.action === 'checkin') {
      if (!validId(input.userId) || !validId(input.requestId)) throw loungeError('invalid-request');
      return reply(200, { success: true, ...await checkInLounge(db, uid, input, now) });
    }
    if (!validId(input.sessionId)) throw loungeError('invalid-request');
    const session = (await db.collection(C.VISIT_SESSIONS).doc(input.sessionId).get()).data();
    if (!session || session.storeId !== input.storeId) throw loungeError('session-not-found');
    if (input.action === 'sync-redemptions') {
      await db.runTransaction(async tx => { await authorizeLounge(tx, db, uid, session.userId, session.storeId, true); });
      await syncLoungeRedemptions(db, input.sessionId);
      return reply(200, { success: true });
    }
    if (input.action === 'checkout') return reply(200, { success: true,
      ...await settleLoungeVisit(db, input.sessionId, now, { uid, forceHours: input.forceHours }) });
    if (input.action === 'realtime') return reply(200, { success: true, ...await deductLoungeRealtime(db, input.sessionId, uid, now) });
    throw loungeError('invalid-request');
  } catch (error: any) {
    const code = error?.message;
    if (String(error?.code).startsWith('auth/')) return reply(401, { success: false, code: 'auth-required' });
    const known = ['invalid-hours', 'invalid-request', 'forbidden', 'not-ready', 'not-enabled', 'outside-hours', 'already-checked-in',
      'membership-inactive', 'insufficient-checkin', 'lounge-unavailable', 'session-not-found', 'member-not-found', 'active-visits', 'channel-unverified', 'busy', 'before-closing',
      'invalid-report-date', 'report-not-found', 'test-report-not-found', 'test-confirm-required', 'test-report-expired', 'test-report-rate-limit',
      'invalid-baseline', 'baseline-conflict', 'baseline-does-not-reconcile', 'scan-limit'];
    return reply(code === 'forbidden' ? 403 : known.includes(code) ? 409 : 503, {
      success: false, code: known.includes(code) ? code : 'service-unavailable', details: error?.details || {},
    });
  }
};
export default toWebFunction(eventHandler);
