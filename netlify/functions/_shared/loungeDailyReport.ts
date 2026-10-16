import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';
import { businessDayStart } from '../../../src/utils/loungeOperations';
import { reconcileLoungeDebt, type DebtEntry } from '../../../src/utils/loungeDebt';
import { asDate, loungeError } from './loungeVisits';
import { assertWhatsAppBinding, loadWhatsApp, submitWhapi } from './whatsapp';
import { readWhapiHealth } from './whatsappConnection';
import { attachSubmission } from './whapiReceipts';

export async function readPaged(query: any, max = 10000) {
  const docs: any[] = []; let cursor: any;
  while (true) {
    const page = await (cursor ? query.startAfter(cursor) : query).limit(250).get();
    docs.push(...page.docs);
    if (docs.length > max) throw loungeError('scan-limit');
    if (page.size < 250) return docs;
    cursor = page.docs[page.size - 1];
  }
}

export async function buildLoungeReportSnapshot(db: Firestore, storeId: string, date: string, batch: any, revision: number, test = false) {
  const store = (await db.collection(C.STORES).doc(storeId).get()).data();
  const sessions = await readPaged(db.collection(C.VISIT_SESSIONS).where('storeId', '==', storeId).orderBy('__name__'));
  const start = businessDayStart(date).getTime(), end = start + 86400000, asOf = Date.now();
  const daily = sessions.filter(d => { const at = asDate(d.data().checkInAt).getTime(); return at >= start && at < end; });
  const redemptions = await readPaged(db.collection(C.REDEMPTION_RECORDS).orderBy('__name__'));
  const sessionIds = new Set(daily.map(d => d.id));
  let pendingCigars = 0, confirmedCigars = 0;
  for (const doc of redemptions) {
    if (!sessionIds.has(doc.data().visitSessionId || doc.id)) continue;
    for (const item of doc.data().redemptions || []) {
      if (item.type === 'referral_reward') continue;
      if (item.status === 'pending') pendingCigars += Number(item.quantity) || 0;
      if (item.status === 'completed') confirmedCigars += Number(item.quantity) || 0;
    }
  }
  const entries = await readPaged(db.collection(C.POINTS_RECORDS).orderBy('__name__'));
  const grouped = new Map<string, DebtEntry[]>(); let invalid = 0;
  for (const doc of entries) {
    const record = doc.data();
    if (record.isVisitSessionSummary || record.migration?.balanceNotApplied || record.migration?.source === 'legacy_workbook') continue;
    const at = asDate(record.createdAt).getTime();
    if (!Number.isFinite(at) || !Number.isFinite(record.amount) || !['earn', 'spend'].includes(record.type)) { invalid++; continue; }
    const rows = grouped.get(record.userId) || [];
    rows.push({ id: doc.id, at, amount: (record.type === 'earn' ? 1 : -1) * record.amount,
      before: record.balanceBefore, after: record.balance, storeId: record.storeId });
    grouped.set(record.userId, rows);
  }
  const users = await readPaged(db.collection(C.USERS).orderBy('__name__'));
  const debt = { opening: 0, added: 0, repaid: 0, closing: 0, unallocated: 0, review: invalid };
  for (const user of users) {
    const current = user.data().membership?.points;
    const result = reconcileLoungeDebt(grouped.get(user.id) || [], start, asOf, current);
    if (!result.reliable) { if (current < 0 || grouped.has(user.id)) debt.review++; continue; }
    debt.opening += result.opening[storeId] || 0; debt.added += result.added[storeId] || 0;
    debt.repaid += result.repaid[storeId] || 0; debt.closing += result.closing[storeId] || 0;
    debt.unallocated += result.closing.unallocated || 0;
  }
  const completed = daily.filter(d => d.data().status === 'completed');
  const fees = completed.reduce((sum, d) => sum + (d.data().pointsDeducted || 0), 0);
  const n = (value: number) => value.toFixed(2);
  const testPending = test ? sessions.filter(d => d.data().status === 'pending' && asDate(d.data().checkInAt).getTime() < end).length : 0;
  const text = `[Macanudo Socials]\n${test ? '[TEST] ' : ''}Daily Lounge Report\n${store?.name || storeId}\nBusiness date: ${date} (MYT)\n${test ? 'Read-only test snapshot; no checkout or wallet changes.\n' : `Revision: ${revision}\n`}`
    + `Settlement: ${test ? 'NOT EXECUTED - TEST ONLY' : batch.status === 'completed' ? 'COMPLETE' : 'INCOMPLETE - action required'}\n`
    + `Check-ins: ${daily.length}\nCompleted visits: ${completed.length}\nUnresolved visits (including carryovers): ${test ? testPending : batch.remaining}\nUnresolved stock settlements: ${test ? sessions.filter(d => d.data().inventorySettlementStatus === 'pending').length : batch.inventoryRemaining || 0}\nVisit fees (today's arrivals): ${n(fees)} points\n`
    + `Confirmed cigars: ${confirmedCigars}\nPending cigar selections: ${pendingCigars}\n`
    + `Historical opening debt: ${n(debt.opening)} points\nNew debt in snapshot window (gross): ${n(debt.added)} points\nDebt repaid in snapshot window (FIFO): ${n(debt.repaid)} points\n`
    + `${test ? 'Outstanding debt at test snapshot' : 'Closing debt after settlement'}: ${n(debt.closing)} points\nNetwork-wide unallocated historical debt: ${n(debt.unallocated)} points (not charged to this lounge)\n`
    + `Wallets/entries requiring review: ${debt.review}\nDebt figures include reconciled wallets only.\nPending cigar selections are retained; no automatic selection or cancellation.\n`
    + `Debt snapshot window: ${new Date(start).toISOString()} to ${new Date(asOf).toISOString()}\n`
    + (asOf >= end ? `${test ? 'HISTORICAL TEST' : 'LATE RECOVERY'}: debt window includes later activity; this is not the original day-end debt snapshot.\n` : '')
    + `Snapshot: ${new Date(asOf).toISOString()}`;
  return { text, debt, createdAt: Timestamp.fromMillis(asOf) };
}

export async function createLoungeReport(db: Firestore, storeId: string, date: string, batch: any, revision: number) {
  const ref = db.collection(C.LOUNGE_REPORTS).doc(`${storeId}_${date}_v${revision}`);
  if ((await ref.get()).exists) return ref;
  const snapshot = await buildLoungeReportSnapshot(db, storeId, date, batch, revision);
  await db.runTransaction(async tx => {
    if ((await tx.get(ref)).exists) return;
    tx.create(ref, { storeId, businessDate: date, revision, ...snapshot, batchStatus: batch.status,
      delivery: { status: 'not-sent' } });
  });
  return ref;
}

export async function sendLoungeReport(db: Firestore, ref: any) {
  if (process.env.LOUNGE_DAILY_REPORTS_ENABLED !== 'true') return;
  const report = (await ref.get()).data();
  if (!report || report.delivery?.status !== 'not-sent') return;
  const store = (await db.collection(C.STORES).doc(report.storeId).get()).data();
  if (!store?.operations?.dailyReportEnabled) return;
  const loaded = await loadWhatsApp(db);
  if (!loaded.config.enabled || !loaded.verified || !loaded.token || loaded.config.whapi.channelId !== store.operations.whapiChannelId) throw loungeError('channel-unverified');
  const health = await readWhapiHealth(loaded.token, store.operations.whapiChannelId);
  const settings = (await db.collection(C.WHATSAPP_CONFIG).doc('settings').get()).data();
  if (health.status !== 'connected' || health.account !== settings?.whapiUserId) throw loungeError('channel-unverified');
  const taskId = `lounge-${ref.id}`, taskRef = db.collection(C.WHATSAPP_TASKS).doc(taskId);
  const claimed = await db.runTransaction(async tx => {
    const snapshot: any = await tx.get(ref);
    const fresh = snapshot.data();
    const freshStore = (await tx.get(db.collection(C.STORES).doc(report.storeId))).data();
    const freshSettings = (await tx.get(db.collection(C.WHATSAPP_CONFIG).doc('settings'))).data();
    await assertWhatsAppBinding(db, tx, loaded.binding, true);
    if (fresh?.delivery?.status !== 'not-sent' || freshSettings?.config?.enabled !== true || !freshStore?.operations?.dailyReportEnabled
      || freshStore.operations.whapiChannelId !== health.channelId) return false;
    // A timeout after this point is ambiguous. Do not automatically resend.
    tx.update(ref, { delivery: { status: 'unknown', recipient: health.account, channelId: health.channelId, binding: loaded.binding || '', attemptedAt: Timestamp.now() } });
    tx.create(taskRef, { provider: 'whapi', kind: 'custom', source: 'lounge-daily-report', reportId: ref.id,
      phone: health.account, text: report.text, status: 'unknown', channelId: health.channelId, createdBy: 'system', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    return true;
  });
  if (!claimed) return;
  try {
    const result = await submitWhapi(loaded.token, health.account, report.text);
    await attachSubmission(db, taskId, health.channelId, { ...result, status: result.status === 'accepted' && !result.messageId ? 'unknown' : result.status });
    await ref.update({ 'delivery.status': result.status === 'accepted' && !result.messageId ? 'unknown' : result.status,
      'delivery.messageId': result.messageId || '', 'delivery.updatedAt': Timestamp.now() });
  } catch { /* The unknown state deliberately survives transport failures. */ }
}
