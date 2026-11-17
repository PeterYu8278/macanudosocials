import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';
import { walletLedgerTreatments } from '../../../src/utils/walletLedgerEvidence';
import { reconcileLoungeDebt, type DebtBaseline } from '../../../src/utils/loungeDebt';
import { asDate, authorizeLounge, loungeError } from './loungeVisits';

// Only an explicit human review may register a baseline. This never credits or debits the wallet.
export async function saveWalletDebtBaseline(db: Firestore, uid: string, input: any, now = Date.now()) {
  if (input.confirm !== true || !/^[\w-]{1,160}$/.test(input.userId || '')
    || !Number.isSafeInteger(input.at) || input.at < Date.UTC(2000, 0, 1) || input.at > now
    || typeof input.balance !== 'number' || !Number.isFinite(input.balance) || Math.round(input.balance * 100) / 100 !== input.balance
    || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0 || input.expectedVersion >= Number.MAX_SAFE_INTEGER
    || typeof input.evidenceReference !== 'string' || input.evidenceReference.trim().length < 5 || input.evidenceReference.length > 500
    || typeof input.note !== 'string' || input.note.trim().length < 10 || input.note.length > 1000) throw loungeError('invalid-baseline');
  return db.runTransaction(async tx => {
    const actor = await authorizeLounge(tx, db, uid, uid, input.storeId, true);
    if (!['superAdmin', 'developer'].includes(actor.role) || actor.status === 'suspended') throw loungeError('forbidden');
    const store = await tx.get(db.collection(C.STORES).doc(input.storeId));
    if (!store.exists) throw loungeError('lounge-unavailable');
    const user = await tx.get(db.collection(C.USERS).doc(input.userId));
    if (!user.exists) throw loungeError('member-not-found');
    const ref = db.collection(C.WALLET_DEBT_BASELINES).doc(input.userId), old = await tx.get(ref);
    if ((old.data()?.version || 0) !== input.expectedVersion) throw loungeError('baseline-conflict');
    const records = await tx.get(db.collection(C.POINTS_RECORDS).where('userId', '==', input.userId).limit(10001));
    if (records.size > 10000) throw loungeError('scan-limit');
    const baseline: DebtBaseline = { version: input.expectedVersion + 1, at: input.at, balance: input.balance,
      boundary: 'through_timestamp', evidenceReference: input.evidenceReference.trim(), note: input.note.trim(), reviewedBy: uid, approvedAt: now };
    const treatments = walletLedgerTreatments(records.docs.map(d => ({ ...d.data(), id: d.id })));
    const entries = records.docs.filter(d => ['included', 'historical-included'].includes(treatments.get(d.id)!)).map(d => {
      const row = d.data();
      return { id: d.id, at: asDate(row.createdAt).getTime(),
        amount: typeof row.amount === 'number' && row.amount >= 0 && ['earn', 'spend'].includes(row.type)
          ? (row.type === 'earn' ? 1 : -1) * row.amount : NaN,
        before: row.balanceBefore, after: row.balance, storeId: row.storeId };
    });
    const current = user.data()?.membership?.points;
    const result = reconcileLoungeDebt(entries, input.at, now, current, baseline);
    if (typeof current !== 'number' || !Number.isFinite(current) || !result.reliable) throw loungeError('baseline-does-not-reconcile', { reasons: result.reasons });
    const saved = { ...baseline, userId: input.userId, reviewedAtStoreId: input.storeId };
    tx.set(ref, saved);
    tx.create(db.collection(C.WALLET_DEBT_BASELINE_VERSIONS).doc(`${input.userId}_v${baseline.version}`), saved);
    tx.create(db.collection(C.AUDIT_LOGS).doc(), { action: 'wallet-debt-baseline', operatorId: uid, userId: input.userId,
      storeId: input.storeId, before: old.data() || null, after: saved, createdAt: Timestamp.fromMillis(now) });
    return { version: baseline.version };
  });
}
