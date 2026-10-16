import { randomUUID } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';
import { businessCutoff, firstVisitCutoff, localBusinessDate } from '../../../src/utils/loungeOperations';
import { asDate, loungeError, settleLoungeVisit, syncLoungeRedemptions } from './loungeVisits';
import { createLoungeReport, readPaged, sendLoungeReport } from './loungeDailyReport';

export function closingRound(now: Date) {
  const elapsed = now.getTime() - businessCutoff(localBusinessDate(now)).getTime();
  return elapsed < 0 ? 0 : Math.min(3, Math.floor(elapsed / 300000) + 1);
}

async function dueVisits(db: Firestore, storeId: string, cutoff: Date) {
  const docs = await readPaged(db.collection(C.VISIT_SESSIONS).where('storeId', '==', storeId).where('status', '==', 'pending').orderBy('__name__'));
  return docs.filter(doc => {
    const checkIn = asDate(doc.data().checkInAt);
    // Invalid sessions must be visible as unresolved rather than silently skipped.
    return !Number.isFinite(checkIn.getTime()) || firstVisitCutoff(checkIn) <= cutoff;
  });
}

export async function previewLoungeClosing(db: Firestore, storeId: string, now: Date) {
  const cutoff = businessCutoff(localBusinessDate(now)), due = await dueVisits(db, storeId, cutoff);
  const rows = [];
  for (const doc of due.slice(0, 50)) {
    try { rows.push({ sessionId: doc.id, ...await settleLoungeVisit(db, doc.id, cutoff, { automatic: true, preview: true }) }); }
    catch { rows.push({ sessionId: doc.id, status: 'requires-review' }); }
  }
  return { cutoff: cutoff.toISOString(), total: due.length, truncated: due.length > 50, rows };
}

export async function runLoungeClosing(db: Firestore, storeId: string, now: Date, options: { manual?: boolean; businessDate?: string } = {}) {
  const date = options.businessDate || localBusinessDate(now), cutoff = businessCutoff(date);
  if (now < cutoff) throw loungeError('before-closing');
  const round = date < localBusinessDate(now) ? 3 : closingRound(now);
  const ref = db.collection(C.LOUNGE_BATCHES).doc(`${storeId}_${date}`), token = randomUUID();
  const claimed = await db.runTransaction(async tx => {
    const batch = (await tx.get(ref)).data();
    const store = (await tx.get(db.collection(C.STORES).doc(storeId))).data();
    if (!store?.operations?.enabled) return false;
    if (batch?.leaseUntil?.toMillis() > Date.now()) throw loungeError('busy');
    if (!options.manual && (batch?.status === 'completed' || (batch?.round || 0) >= round)) return false;
    tx.set(ref, { storeId, businessDate: date, round, status: 'running', leaseToken: token, lastError: null,
      leaseUntil: Timestamp.fromMillis(Date.now() + 120000), updatedAt: Timestamp.now(),
      revision: (batch?.revision || 1) + (options.manual && batch ? 1 : 0), manual: !!options.manual }, { merge: true });
    return true;
  });
  if (!claimed) {
    const previous = (await ref.get()).data();
    // Report failure never re-enters financial settlement.
    if (previous && ['completed', 'incomplete'].includes(previous.status)) {
      const report = await createLoungeReport(db, storeId, date, previous, previous.revision || 1);
      await sendLoungeReport(db, report);
    }
    return { skipped: true };
  }
  const deadline = Date.now() + 20000;
  let failed = 0, completed = 0;
  try {
    for (const doc of await dueVisits(db, storeId, cutoff)) {
      if (Date.now() >= deadline) break;
      try { await settleLoungeVisit(db, doc.id, now, { automatic: true }); completed++; }
      catch { failed++; }
    }
    const repair = await readPaged(db.collection(C.VISIT_SESSIONS).where('storeId', '==', storeId).where('inventorySettlementStatus', '==', 'pending').orderBy('__name__'));
    for (const doc of repair) {
      if (Date.now() >= deadline) break;
      try { await syncLoungeRedemptions(db, doc.id); } catch { failed++; }
    }
    const remaining = (await dueVisits(db, storeId, cutoff)).length;
    const inventoryRemaining = (await readPaged(db.collection(C.VISIT_SESSIONS).where('storeId', '==', storeId).where('inventorySettlementStatus', '==', 'pending').orderBy('__name__'))).length;
    const batch = { status: !remaining && !inventoryRemaining && !failed ? 'completed' : round >= 3 ? 'incomplete' : 'waiting', inventoryRemaining,
      remaining, failed, completed, round, finishedAt: Timestamp.now() };
    await db.runTransaction(async tx => {
      const fresh = (await tx.get(ref)).data();
      if (fresh?.leaseToken !== token) throw loungeError('busy');
      tx.update(ref, { ...batch, leaseUntil: Timestamp.fromMillis(0), updatedAt: Timestamp.now() });
    });
    if (batch.status !== 'waiting') {
      const saved = (await ref.get()).data();
      const report = await createLoungeReport(db, storeId, date, batch, saved?.revision || 1);
      await sendLoungeReport(db, report);
    }
    return batch;
  } catch (error) {
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (current?.leaseToken === token) tx.update(ref, { leaseUntil: Timestamp.fromMillis(0), lastError: 'processing-or-report-failed', updatedAt: Timestamp.now() });
    });
    throw error;
  }
}

