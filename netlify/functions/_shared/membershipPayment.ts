import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from './firestoreMonitoring';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';

export const dateOf = (value: any): Date | null => {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

export function annualFee(config: any, now = new Date()): number {
  const fees = (config?.annualFees || []).filter((fee: any) => {
    const start = dateOf(fee.startDate), end = dateOf(fee.endDate);
    return start && start <= now && (!end || end >= now);
  }).sort((a: any, b: any) => dateOf(b.startDate)!.getTime() - dateOf(a.startDate)!.getTime());
  const amount = Number(fees[0]?.amount ?? 150);
  if (!Number.isFinite(amount) || amount <= 0 || Number(amount.toFixed(2)) !== amount) throw new Error('INVALID_MEMBERSHIP_FEE');
  return amount;
}

export async function hasAnnualHistory(db: Firestore, userId: string): Promise<boolean> {
  // Membership dates can be legacy placeholders or client-editable metadata.
  // Only trusted paid fee records authorize the wallet renewal path.
  const records = await db.collection(C.MEMBERSHIP_FEE_RECORDS)
    .where('userId', '==', userId).where('status', '==', 'paid').limit(100).get();
  return records.docs.some(record => {
    const amount = Number(record.data().amount);
    return Number.isFinite(amount) && amount > 0;
  });
}

export async function reconcileMembershipStatus(db: Firestore, userId: string, current: any): Promise<void> {
  const end = dateOf(current.membership?.activeUntil);
  if (!end || current.status === 'suspended') return;
  const now = new Date();
  if (!(current.status === 'active' && end <= now) && !(current.status === 'inactive' && end > now)) return;
  const userRef = db.collection(C.USERS).doc(userId);
  await db.runTransaction(async tx => {
    const snapshot = await tx.get(userRef);
    if (!snapshot.exists) throw new Error('USER_NOT_FOUND');
    const user = snapshot.data()!;
    const until = dateOf(user.membership?.activeUntil);
    if (!until || user.status === 'suspended') return;
    if (user.status === 'active' && until <= now) {
      tx.update(userRef, { status: 'inactive', updatedAt: Timestamp.fromDate(now) });
    } else if (user.status === 'inactive' && until > now) {
      const from = dateOf(user.membership?.activeFrom);
      const records = await tx.get(db.collection(C.MEMBERSHIP_FEE_RECORDS)
        .where('userId', '==', userId).where('status', '==', 'paid').limit(100));
      // A paid fee must match this activation period, not merely exist in older history.
      const verified = from && from <= now && until > from && until.getTime() - from.getTime() <= 367 * 86400000
        && records.docs.some(record => {
          const fee = record.data();
          const paidAt = dateOf(fee.deductedAt);
          return Number(fee.amount) > 0 && paidAt && Math.abs(paidAt.getTime() - from.getTime()) <= 60000;
        });
      if (!verified) throw new Error('MEMBERSHIP_STATUS_UNVERIFIED');
      tx.update(userRef, {
        status: 'active', role: ['guest', 'member'].includes(user.role) ? 'vip' : user.role,
        updatedAt: Timestamp.fromDate(now),
      });
    }
  });
}

// The order and wallet are read in the same transaction so parallel callbacks cannot credit twice.
export async function fulfillMembershipPayment(db: Firestore, orderId: string, billId: string, paidCents: number) {
  const orderRef = db.collection(C.MEMBERSHIP_PAYMENTS).doc(orderId);
  return db.runTransaction(async tx => {
    const orderSnapshot = await tx.get(orderRef);
    if (!orderSnapshot.exists) throw new Error('PAYMENT_NOT_FOUND');
    const order = orderSnapshot.data()!;
    if (!billId || (order.billplzId && order.billplzId !== billId) || order.totalCents !== paidCents) throw new Error('PAYMENT_AMOUNT_MISMATCH');
    if (['fulfilled', 'credited'].includes(order.status)) return order.status;
    if (!['creating', 'pending'].includes(order.status)) throw new Error('PAYMENT_NOT_READY');
    const userRef = db.collection(C.USERS).doc(order.userId);
    const [userSnapshot, pendingFees] = await Promise.all([
      tx.get(userRef),
      tx.get(db.collection(C.MEMBERSHIP_FEE_RECORDS).where('userId', '==', order.userId).where('status', '==', 'pending')),
    ]);
    if (!userSnapshot.exists) throw new Error('USER_NOT_FOUND');
    const user = userSnapshot.data()!;
    const now = new Date(), timestamp = Timestamp.fromDate(now);
    const currentPoints = Number(user.membership?.points || 0);
    if (!Number.isFinite(currentPoints)) throw new Error('INVALID_POINTS_BALANCE');
    // Another activation or suspension must not lose a completed payment or charge a second year.
    const total = order.totalCents / 100;
    const creditOnly = user.status === 'active' || user.status === 'suspended'
      || (order.paymentMode === 'renewal_reload' && currentPoints + total < order.annualFee);
    const balance = currentPoints + total - (creditOnly ? 0 : order.annualFee);
    const feeRef = pendingFees.docs.find(doc => doc.data().renewalType === order.renewalType)?.ref
      || pendingFees.docs[0]?.ref
      || db.collection(C.MEMBERSHIP_FEE_RECORDS).doc(`payment_${orderId}`);
    const until = new Date(now); until.setFullYear(until.getFullYear() + 1);
    const update: Record<string, unknown> = { 'membership.points': balance, updatedAt: timestamp };
    if (!creditOnly) {
      Object.assign(update, {
        status: 'active', role: ['guest', 'member'].includes(user.role) ? 'vip' : user.role,
        'membership.activeFrom': timestamp, 'membership.activeUntil': Timestamp.fromDate(until),
        ...(order.renewalType === 'initial' ? { 'membership.firstActivatedAt': timestamp } : {
          'membership.nextFirstVisitWaiverExpiresAt': null,
        }),
      });
    }
    tx.update(userRef, update);
    if (order.reloadAmount > 0 || creditOnly) tx.set(db.collection(C.RELOAD_RECORDS).doc(`membership_${orderId}`), {
      userId: order.userId, userName: user.displayName || '', requestedAmount: total,
      pointsEquivalent: total, walletAmount: creditOnly || order.paymentMode === 'renewal_reload' ? total : order.reloadAmount,
      annualFeeAmount: creditOnly ? 0 : order.annualFee, paymentPurpose: 'annual_pass',
      billplzId: billId, status: 'completed', storeId: order.storeId,
      verifiedBy: 'system_billplz', verifiedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    });
    tx.set(db.collection(C.POINTS_RECORDS).doc(`membership_${orderId}_credit`), {
      userId: order.userId, userName: user.displayName || '', type: 'earn', amount: total,
      source: 'reload', description: 'Annual Pass payment credit', relatedId: orderId,
      balance: currentPoints + total, createdBy: 'membership-payment', createdAt: timestamp,
    });
    if (!creditOnly) {
      const pointsId = `membership_${orderId}_fee`;
      tx.set(db.collection(C.POINTS_RECORDS).doc(pointsId), {
        userId: order.userId, userName: user.displayName || '', type: 'spend', amount: order.annualFee,
        source: 'membership_fee', description: `Annual Pass (${order.renewalType})`,
        relatedId: feeRef.id, balance, createdBy: 'membership-payment', createdAt: timestamp,
      });
      tx.set(feeRef, {
        userId: order.userId, userName: user.displayName || '', amount: order.annualFee,
        renewalType: order.renewalType, status: 'paid', dueDate: timestamp, deductedAt: timestamp,
        pointsRecordId: pointsId, storeId: order.storeId, createdAt: timestamp, updatedAt: timestamp,
      });
      tx.set(db.collection(C.MEMBERSHIP_FEE_RECORDS).doc(`${feeRef.id}_renewal`), {
        userId: order.userId, userName: user.displayName || '', amount: order.annualFee,
        renewalType: 'renewal', status: 'pending', dueDate: Timestamp.fromDate(until),
        previousDueDate: timestamp, storeId: order.storeId, createdAt: timestamp, updatedAt: timestamp,
      });
      if (order.renewalType === 'initial' && user.referral?.referredByUserId) {
        tx.set(db.doc(`${C.USERS}/${user.referral.referredByUserId}/referrals/${order.userId}`), {
          referredUserId: order.userId, referredUserName: user.displayName || '',
          referredUserMemberId: user.memberId || null, membershipActivatedAt: timestamp,
          createdAt: user.referral.referralDate || timestamp, updatedAt: timestamp,
        }, { merge: true });
      }
    }
    const status = creditOnly ? 'credited' : 'fulfilled';
    tx.update(orderRef, { status, billplzId: billId, balance, fulfilledAt: timestamp, updatedAt: timestamp });
    tx.delete(db.collection(C.MEMBERSHIP_PAYMENT_LOCKS).doc(order.userId));
    return status;
  });
}

export async function handleMembershipBill(db: Firestore, billId: string, paidCents: number, clientSignatureValid: boolean, orderId?: string, proof?: string) {
  if (orderId) {
    if (!clientSignatureValid) throw new Error('INVALID_PAYMENT_SIGNATURE');
    // Query parameters are not signed by Billplz. A private per-order proof binds the callback to its order.
    const order = await db.collection(C.MEMBERSHIP_PAYMENTS).doc(orderId).get();
    if (!proof || !order.exists || order.data()?.callbackProof !== proof) throw new Error('INVALID_PAYMENT_BINDING');
    await fulfillMembershipPayment(db, orderId, billId, paidCents);
    return true;
  }
  const orders = await db.collection(C.MEMBERSHIP_PAYMENTS).where('billplzId', '==', billId).limit(1).get();
  if (orders.empty) return false;
  if (!clientSignatureValid) throw new Error('INVALID_PAYMENT_SIGNATURE');
  await fulfillMembershipPayment(db, orders.docs[0].id, billId, paidCents);
  return true;
}
