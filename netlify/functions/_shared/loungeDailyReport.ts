import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';
import { businessDayStart } from '../../../src/utils/loungeOperations';
import { reconcileLoungeDebt, validDebtBaseline, type DebtEntry, type DebtBaseline } from '../../../src/utils/loungeDebt';
import { classifyPointsRecord } from '../../../src/utils/pointsRecordClassification';
import { walletLedgerTreatments } from '../../../src/utils/walletLedgerEvidence';
import { loungeDailyPaymentStats } from '../../../src/utils/loungeDailyPaymentStats';
import { asDate, loungeError } from './loungeVisits';
import { attachSubmission } from './whapiReceipts';
import { loadLoungeReportTransport, loungeReportTaskId } from './loungeReportTransport';
import type { LoungeDebtDetails, LoungeDebtCustomer } from '../../../src/types/loungeReport';

export async function readPaged(query: any, max = 10000, get: (target: any) => Promise<any> = target => target.get()) {
  const docs: any[] = []; let cursor: any;
  while (true) {
    const page = await get((cursor ? query.startAfter(cursor) : query).limit(250));
    docs.push(...page.docs);
    if (docs.length > max) throw loungeError('scan-limit');
    if (page.size < 250) return docs;
    cursor = page.docs[page.size - 1];
  }
}

export async function buildLoungeReportSnapshot(db: Firestore, storeId: string, date: string, batch: any, revision: number, test = false, reportId?: string) {
  const start = businessDayStart(date).getTime(), end = start + 86400000;
  // Every wallet, baseline and ledger page shares one Firestore read timestamp.
  const source = await db.runTransaction(async tx => {
    const store = await tx.get(db.collection(C.STORES).doc(storeId));
    const read = (query: any) => readPaged(query, 10000, target => tx.get(target));
    const [sessions, redemptions, entries, users, baselines, lounges, reloads, fees] = await Promise.all([
      read(db.collection(C.VISIT_SESSIONS).where('storeId', '==', storeId).orderBy('__name__')),
      read(db.collection(C.REDEMPTION_RECORDS).orderBy('__name__')),
      read(db.collection(C.POINTS_RECORDS).orderBy('__name__')),
      read(db.collection(C.USERS).orderBy('__name__')),
      read(db.collection(C.WALLET_DEBT_BASELINES).orderBy('__name__')),
      tx.get(db.collection(C.STORES).orderBy('__name__').limit(2)),
      read(db.collection(C.RELOAD_RECORDS).where('verifiedAt', '>=', Timestamp.fromMillis(start))
        .where('verifiedAt', '<', Timestamp.fromMillis(end)).orderBy('verifiedAt')),
      read(db.collection(C.MEMBERSHIP_FEE_RECORDS).where('deductedAt', '>=', Timestamp.fromMillis(start))
        .where('deductedAt', '<', Timestamp.fromMillis(end)).orderBy('deductedAt')),
    ]);
    return { store: store.data(), sessions, redemptions, entries, users, baselines, reloads, fees,
      hasOtherLounges: lounges.docs.some(doc => doc.id !== storeId), asOf: store.readTime?.toMillis() || Date.now() };
  }, { readOnly: true });
  const { store, sessions, redemptions, entries, users, asOf } = source;
  const baselines = new Map<string, DebtBaseline>(source.baselines.map(doc => [doc.id, doc.data() as DebtBaseline]));
  const paymentStats = loungeDailyPaymentStats(source.reloads.map(d => d.data()), source.fees.map(d => d.data()), storeId, start, end, asOf);
  const daily = sessions.filter(d => { const at = asDate(d.data().checkInAt).getTime(); return at >= start && at < end; });
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
  const grouped = new Map<string, DebtEntry[]>(); let invalid = 0;
  const localUsers = new Set(sessions.map(d => d.data().userId).filter(Boolean));
  const ledgerRows = new Map<string, LoungeDebtCustomer['entries']>();
  const invalidUsers = new Set<string>();
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const treatments = walletLedgerTreatments(entries.filter(doc => {
    const at = asDate(doc.data().createdAt).getTime();
    return !Number.isFinite(at) || at <= asOf;
  }).map(doc => ({ ...doc.data(), id: doc.id })));
  for (const doc of entries) {
    const record = doc.data();
    const at = asDate(record.createdAt).getTime();
    if (Number.isFinite(at) && at > asOf) continue;
    const kind = classifyPointsRecord(record), baseline = baselines.get(record.userId);
    const treatment = treatments.get(doc.id)!;
    const included = treatment === 'included' || treatment === 'historical-included';
    const covered = included && baseline && validDebtBaseline(baseline) && baseline.approvedAt <= asOf && at <= baseline.at;
    const valid = Number.isFinite(at) && typeof record.amount === 'number' && Number.isFinite(record.amount)
      && record.amount >= 0 && ['earn', 'spend'].includes(record.type);
    const participation = !included ? treatment : covered ? 'before-baseline' : valid ? treatment : 'invalid';
    if (record.storeId === storeId && record.userId) localUsers.add(record.userId);
    const evidence = ledgerRows.get(record.userId) || [];
    if (!Number.isFinite(at) || at <= asOf) evidence.push({ id: doc.id, at: Number.isFinite(at) ? new Date(at).toISOString() : null,
      amount: finite(['earn', 'spend'].includes(record.type) ? (record.type === 'earn' ? 1 : -1) * record.amount : NaN),
      before: finite(record.balanceBefore), after: finite(record.balance), source: String(record.source || '').slice(0, 80),
      relatedId: record.storeId === storeId ? String(record.relatedId || '').slice(0, 160) : '',
      description: !record.storeId || record.storeId === storeId ? String(record.description || '').slice(0, 160) : '', local: record.storeId === storeId,
      historical: kind === 'historical', participation });
    ledgerRows.set(record.userId, evidence);
    if (!included || covered) continue;
    if (!valid) { invalid++; invalidUsers.add(record.userId); continue; }
    const rows = grouped.get(record.userId) || [];
    rows.push({ id: doc.id, at, amount: (record.type === 'earn' ? 1 : -1) * record.amount,
      before: record.balanceBefore, after: record.balance, storeId: record.storeId });
    grouped.set(record.userId, rows);
  }
  const debt = { opening: 0, added: 0, repaid: 0, closing: 0, unallocated: 0, review: invalid };
  const debtDetails: LoungeDebtDetails = { businessDate: date, from: new Date(start).toISOString(), to: new Date(asOf).toISOString(),
    historical: asOf >= end, customers: [], otherReviewCount: 0, truncated: false, schemaVersion: 2, consistency: 'transaction', balanceOrigin: 'zero' };
  let evidenceBudget = 1000, localReviewCount = 0;
  for (const user of users) {
    const current = user.data().membership?.points;
    const baseline = baselines.get(user.id);
    const result = reconcileLoungeDebt(grouped.get(user.id) || [], start, asOf, current, baseline, 'zero');
    const needsReview = !result.reliable || invalidUsers.has(user.id) || finite(current) === null;
    const relevant = localUsers.has(user.id) || [result.opening, result.added, result.repaid, result.closing].some(v => v[storeId] > 0);
    if (relevant && needsReview) localReviewCount++;
    if (relevant) {
      if (debtDetails.customers.length >= 200) debtDetails.truncated = true;
      else {
        const allEvidence = (ledgerRows.get(user.id) || []).map(entry => {
          const calculated = result.calculatedBalances[entry.id];
          return calculated ? { ...entry, calculatedBefore: calculated.before, calculatedAfter: calculated.after } : entry;
        }).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
        const evidence = allEvidence.slice(0, Math.min(500, evidenceBudget)); evidenceBudget -= evidence.length;
        if (evidence.length < allEvidence.length) debtDetails.truncated = true;
        debtDetails.customers.push({ userId: user.id, name: String(user.data().displayName || user.id).slice(0, 160), memberId: String(user.data().memberId || '').slice(0, 80),
          expectedBalance: result.expectedBalance, difference: result.difference, baseline: baseline || null,
          entryCounts: { historical: allEvidence.filter(e => e.historical).length, summary: allEvidence.filter(e => e.participation === 'summary').length,
            included: allEvidence.filter(e => ['included', 'historical-included'].includes(e.participation || '')).length, beforeBaseline: allEvidence.filter(e => e.participation === 'before-baseline').length,
            invalid: allEvidence.filter(e => e.participation === 'invalid').length },
          reliable: !needsReview, reasons: [...new Set([...result.reasons, ...(invalidUsers.has(user.id) ? ['invalid-entry'] : []), ...(finite(current) === null ? ['wallet-missing'] : [])])], walletBalance: finite(current),
          opening: needsReview ? null : result.opening[storeId] || 0, added: needsReview ? null : result.added[storeId] || 0,
          repaid: needsReview ? null : result.repaid[storeId] || 0, outstanding: needsReview ? null : result.closing[storeId] || 0,
          entries: evidence, entryCount: allEvidence.length });
      }
    }
    if (!relevant && needsReview && (current < 0 || grouped.has(user.id) || invalidUsers.has(user.id))) debtDetails.otherReviewCount++;
    if (needsReview) { if (relevant || current < 0 || grouped.has(user.id)) debt.review++; continue; }
    debt.opening += result.opening[storeId] || 0; debt.added += result.added[storeId] || 0;
    debt.repaid += result.repaid[storeId] || 0; debt.closing += result.closing[storeId] || 0;
    debt.unallocated += result.closing.unallocated || 0;
  }
  const knownUsers = new Set(users.map(user => user.id));
  for (const userId of new Set([...ledgerRows.keys(), ...invalidUsers])) {
    if (knownUsers.has(userId)) continue;
    debt.review++;
    if (!localUsers.has(userId)) { debtDetails.otherReviewCount++; continue; }
    localReviewCount++;
    if (debtDetails.customers.length >= 200) { debtDetails.truncated = true; continue; }
    const evidence = ledgerRows.get(userId) || [], saved = evidence.slice(0, Math.min(20, evidenceBudget));
    evidenceBudget -= saved.length;
    if (saved.length < evidence.length) debtDetails.truncated = true;
    debtDetails.customers.push({ userId: userId || 'unknown-customer', name: '', memberId: '', reliable: false,
      reasons: ['missing-user'], walletBalance: null, opening: null, added: null, repaid: null, outstanding: null,
      entries: saved, entryCount: evidence.length });
  }
  const completed = daily.filter(d => d.data().status === 'completed');
  // Leave headroom for report text and delivery metadata under Firestore's document limit.
  if (Buffer.byteLength(JSON.stringify(debtDetails), 'utf8') > 700000) throw loungeError('scan-limit');
  const fees = completed.reduce((sum, d) => sum + (d.data().pointsDeducted || 0), 0);
  const customers = new Set(daily.map(d => d.data().userId).filter(Boolean)).size;
  // Match the settled fee population and stored billing hours, excluding ongoing visits.
  const hours = completed.reduce((sum, d) => sum + (Number(d.data().durationHours) || 0), 0);
  const n = (value: number) => value.toFixed(2);
  const testPending = test ? sessions.filter(d => d.data().status === 'pending' && asDate(d.data().checkInAt).getTime() < end).length : 0;
  const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  let detailsLink = '';
  try {
    const url = new URL('/admin/lounge-reports', process.env.URL || '');
    if (reportId && url.protocol === 'https:') {
      url.search = new URLSearchParams({ loungeId: storeId, reportId, reportKind: test ? 'test' : 'formal' }).toString();
      detailsLink = `Debt details (staff login required): ${url.toString()}\n`;
    }
  } catch { /* Local previews can open details directly without a public URL. */ }
  const text = `[Macanudo Socials]\n${test ? '[TEST] ' : ''}Daily Lounge Report\n${store?.name || storeId}\nBusiness date: ${date} (MYT)\n${test ? 'Read-only test snapshot; no checkout or wallet changes.\n' : `Revision: ${revision}\n`}`
    + `\n> *Visitation*\nSettlement: ${test ? 'NOT EXECUTED - TEST ONLY' : batch.status === 'completed' ? 'COMPLETE' : 'INCOMPLETE - action required'}\n`
    + `Customers: ${customers}\nCompleted visits: ${completed.length}\nIncompleted visits (including carryovers): ${test ? testPending : batch.remaining}\nVisit fees: ${n(fees)} pts / ${n(hours)} hrs\n`
    + `\n> *Cigar Redemption*\nConfirmed cigars: ${confirmedCigars}\nPending cigar selections: ${pendingCigars}\n`
    + `\n> *Daily Reloads*\nCompleted payments: ${paymentStats.payments}\nPaying customers: ${paymentStats.customers}\nPayments received (including annual fees): RM ${n(paymentStats.received)}\nReload amount (excluding annual fees): RM ${n(paymentStats.reloadAmount)}\nAnnual fees in these payments: RM ${n(paymentStats.annualFees)}\n`
    + `\n> *New Members*\nFirst-time paid activations: ${paymentStats.newMembers}\nExcludes registrations and renewals.\n`
    + `\n> *Outstanding*\nOutstanding lounge debt (verified): ${n(debt.closing)} pts\n`
    + `Data status: ${debt.review ? 'INCOMPLETE' : 'RECONCILED'}\nCustomers requiring review at this lounge: ${localReviewCount}\n`
    + (debt.review ? 'Verified debt excludes unreconciled wallets; the total may be incomplete.\n' : '')
    + (source.hasOtherLounges ? `\nOther lounge review items: ${debtDetails.otherReviewCount}\nUnallocated lounge debt: ${n(debt.unallocated)} pts (excluded from this lounge)\n` : '')
    + (detailsLink ? `\n${detailsLink}` : '')
    + `\nDebt period (MYT): ${time(debtDetails.from)} to ${time(debtDetails.to)}\n`
    + (asOf >= end ? `${test ? 'HISTORICAL TEST' : 'LATE RECOVERY'}: includes activity after the business date; NOT the original day-end debt.\n` : '')
    + `Snapshot (MYT): ${time(debtDetails.to)}`;
  return { text, debt, debtDetails, paymentStats, createdAt: Timestamp.fromMillis(asOf) };
}

export async function createLoungeReport(db: Firestore, storeId: string, date: string, batch: any, revision: number) {
  const ref = db.collection(C.LOUNGE_REPORTS).doc(`${storeId}_${date}_v${revision}`);
  if ((await ref.get()).exists) return ref;
  const snapshot = await buildLoungeReportSnapshot(db, storeId, date, batch, revision, false, ref.id);
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
  const transport = await loadLoungeReportTransport(db, store.operations);
  const taskId = loungeReportTaskId(ref.id, transport.provider), taskRef = db.collection(C.WHATSAPP_TASKS).doc(taskId);
  const expiresAtMs = Date.now() + 5 * 60000;
  const claimed = await db.runTransaction(async tx => {
    const snapshot: any = await tx.get(ref);
    const fresh = snapshot.data();
    const freshStore = (await tx.get(db.collection(C.STORES).doc(report.storeId))).data();
    if (fresh?.delivery?.status !== 'not-sent' || !freshStore?.operations?.dailyReportEnabled) return false;
    await transport.assert(tx, freshStore.operations);
    // A timeout after this point is ambiguous. Do not automatically resend.
    tx.update(ref, { delivery: { status: 'unknown', provider: transport.provider, taskId, recipient: transport.recipient,
      channelId: transport.channelId, binding: transport.binding, attemptedAt: Timestamp.now() } });
    tx.create(taskRef, { provider: transport.provider, kind: 'custom', source: 'lounge-daily-report', reportId: ref.id,
      phone: transport.recipient, text: fresh.text, status: 'unknown', channelId: transport.channelId, expiresAtMs,
      createdBy: 'system', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    return { text: fresh.text as string };
  });
  if (!claimed) return;
  try {
    const result = await transport.submit(taskId, claimed.text, expiresAtMs);
    const status = await attachSubmission(db, taskId, transport.channelId, { ...result, status: result.status === 'accepted' && !result.messageId ? 'unknown' : result.status });
    await ref.update({ 'delivery.status': status,
      'delivery.messageId': result.messageId || '', 'delivery.updatedAt': Timestamp.now() });
  } catch { /* The unknown state deliberately survives transport failures. */ }
}
