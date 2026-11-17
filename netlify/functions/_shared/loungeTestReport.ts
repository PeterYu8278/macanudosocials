import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';
import { businessDayStart, localBusinessDate } from '../../../src/utils/loungeOperations';
import { authorizeLounge, loungeError } from './loungeVisits';
import { buildLoungeReportSnapshot } from './loungeDailyReport';
import { attachSubmission } from './whapiReceipts';
import { loadLoungeReportTransport } from './loungeReportTransport';

async function connection(db: Firestore, storeId: string) {
  const store = (await db.collection(C.STORES).doc(storeId).get()).data();
  if (!store) throw loungeError('lounge-unavailable');
  return loadLoungeReportTransport(db, store.operations, true);
}

export async function executeLoungeTestReport(db: Firestore, uid: string, input: any) {
  // Test actions have their own authorization and never invoke closing/checkout helpers.
  await db.runTransaction(async tx => { await authorizeLounge(tx, db, uid, uid, input.storeId, true); });
  if (input.action === 'test-report-preview') {
    const date = input.businessDate;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !Number.isFinite(businessDayStart(date).getTime()) || localBusinessDate(businessDayStart(date)) !== date
      || date > localBusinessDate(new Date())) throw loungeError('invalid-report-date');
    const transport = await connection(db, input.storeId);
    const ref = db.collection(C.LOUNGE_TEST_REPORTS).doc(randomUUID());
    const snapshot = await buildLoungeReportSnapshot(db, input.storeId, date, {}, 0, true, ref.id);
    const expiresAt = Timestamp.fromMillis(Date.now() + 15 * 60000);
    await ref.create({ ...snapshot, storeId: input.storeId, businessDate: date, ownerId: uid,
      provider: transport.provider, channelId: transport.channelId, recipient: transport.recipient, binding: transport.binding,
      routeKey: transport.routeKey, expiresAt, status: 'not-sent' });
    return { draftId: ref.id, text: snapshot.text, provider: transport.provider, channelId: transport.channelId,
      debtDetails: snapshot.debtDetails,
      recipient: `***${transport.recipient.slice(-4)}`, expiresAt: expiresAt.toDate().toISOString() };
  }
  if (typeof input.draftId !== 'string' || !/^[\w-]{1,160}$/.test(input.draftId)) throw loungeError('invalid-request');
  const ref = db.collection(C.LOUNGE_TEST_REPORTS).doc(input.draftId), draft = (await ref.get()).data();
  if (!draft || draft.ownerId !== uid || draft.storeId !== input.storeId) throw loungeError('test-report-not-found');
  const taskId = `lounge-test-${ref.id}`, taskRef = db.collection(C.WHATSAPP_TASKS).doc(taskId);
  const result = async () => {
    const saved = (await ref.get()).data(), task = (await taskRef.get()).data();
    return { draftId: ref.id, status: task?.status || saved?.status || 'unknown', messageId: task?.messageId || '' };
  };
  if (input.action === 'test-report-status') return result();
  if (input.action !== 'test-report-send' || input.confirm !== true) throw loungeError('test-confirm-required');
  if (draft.status !== 'not-sent') return result();
  if (draft.expiresAt.toMillis() <= Date.now()) throw loungeError('test-report-expired');
  const transport = await connection(db, input.storeId);
  if (transport.recipient !== draft.recipient || transport.channelId !== draft.channelId || transport.binding !== draft.binding
    || transport.provider !== (draft.provider || 'whapi') || (draft.routeKey && draft.routeKey !== transport.routeKey)) throw loungeError('channel-unverified');
  const expiresAtMs = Math.min(Date.now() + 5 * 60000, draft.expiresAt.toMillis());
  const throttleRef = db.collection(C.LOUNGE_TEST_REPORTS).doc(`limit_${uid}_${input.storeId}`);
  const claimed = await db.runTransaction(async tx => {
    const fresh = (await tx.get(ref)).data();
    const throttle = (await tx.get(throttleRef)).data();
    const store = (await tx.get(db.collection(C.STORES).doc(input.storeId))).data();
    await authorizeLounge(tx, db, uid, uid, input.storeId, true);
    if (!store) throw loungeError('channel-unverified');
    await transport.assert(tx, store.operations);
    if (!fresh || fresh.ownerId !== uid || fresh.storeId !== input.storeId) throw loungeError('test-report-not-found');
    if (fresh.status !== 'not-sent') return false;
    if (fresh.expiresAt.toMillis() <= Date.now()) throw loungeError('test-report-expired');
    if (fresh.channelId !== transport.channelId || fresh.recipient !== transport.recipient || fresh.binding !== transport.binding
      || (fresh.provider || 'whapi') !== transport.provider || (fresh.routeKey && fresh.routeKey !== transport.routeKey)) throw loungeError('channel-unverified');
    if (throttle?.sentAt?.toMillis() > Date.now() - 60000) throw loungeError('test-report-rate-limit');
    const now = Timestamp.now();
    tx.set(throttleRef, { sentAt: now });
    // Claim before transport: a crash/timeout remains unknown and cannot auto-resend.
    tx.update(ref, { status: 'unknown', attemptedAt: now });
    tx.create(taskRef, { provider: transport.provider, kind: 'custom', source: 'lounge-test-report', reportId: ref.id,
      phone: fresh.recipient, text: fresh.text, status: 'unknown', channelId: fresh.channelId,
      expiresAtMs, createdBy: uid, createdAt: now, updatedAt: now });
    return true;
  });
  if (claimed) {
    try {
      const submitted = await transport.submit(taskId, draft.text, expiresAtMs);
      const status = await attachSubmission(db, taskId, draft.channelId, {
        ...submitted, status: submitted.status === 'accepted' && !submitted.messageId ? 'unknown' : submitted.status,
      });
      await ref.update({ status, updatedAt: Timestamp.now() });
    } catch { /* Transport ambiguity is visible via the sending record. */ }
  }
  return result();
}
