import type { Firestore } from 'firebase-admin/firestore';
import { Timestamp } from './firestoreMonitoring';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';
import { annualFee, dateOf } from './membershipPayment';
import { calculateReferralPointsFromArray } from '../../../src/utils/referral';
import { writeMembershipPaymentStatus } from './membershipPaymentStatus';

export interface ReloadReview {
  action: 'approve' | 'reject' | 'cancel';
  recordId: string;
  actorId: string;
  actualAmount?: number;
  proof?: string;
  notes?: string;
  creditOnly?: boolean;
}

const operatorRoles = ['admin', 'superAdmin', 'developer', 'storeAdmin'];
export function requireReloadOperator(actor: any, storeId: string | undefined) {
  if (!operatorRoles.includes(actor?.role) || actor?.status === 'suspended'
    || (actor.role === 'storeAdmin' && (!storeId || actor.storeId !== storeId))) throw new Error('FORBIDDEN');
}

// Authorization, the pending record, order lock, wallet and ledgers share one commit.
export async function reviewManualReload(db: Firestore, input: ReloadReview) {
  const recordRef = db.collection(C.RELOAD_RECORDS).doc(input.recordId);
  return db.runTransaction(async tx => {
    const recordSnapshot = await tx.get(recordRef);
    const actorSnapshot = await tx.get(db.collection(C.USERS).doc(input.actorId));
    if (!recordSnapshot.exists || !actorSnapshot.exists) throw new Error('RECORD_NOT_FOUND');
    const record = recordSnapshot.data()!, actor = actorSnapshot.data()!;
    if (input.action === 'cancel') {
      if (record.userId !== input.actorId) throw new Error('FORBIDDEN');
    } else requireReloadOperator(actor, record.storeId);
    if (record.billplzId) throw new Error('ONLINE_PAYMENT_REQUIRES_CALLBACK');
    if (record.status === 'completed' && input.action === 'approve') return { status: 'completed' };
    if (record.status !== 'pending') throw new Error('RECORD_ALREADY_PROCESSED');

    const lockRef = db.collection(C.MEMBERSHIP_PAYMENT_LOCKS).doc(record.userId);
    const lock = await tx.get(lockRef);
    const orderRef = record.membershipOrderId ? db.collection(C.MEMBERSHIP_PAYMENTS).doc(record.membershipOrderId) : null;
    const orderSnapshot = orderRef ? await tx.get(orderRef) : null;
    const order = orderSnapshot?.data();
    if (orderRef && (!orderSnapshot?.exists || order?.paymentMethod !== 'manual'
      || order.userId !== record.userId || order.storeId !== record.storeId || order.status !== 'pending'
      || order.totalCents !== Math.round(record.requestedAmount * 100)
      || input.recordId !== `membership_${orderRef.id}` || lock.data()?.orderId !== orderRef.id)) {
      throw new Error('INVALID_MANUAL_ORDER');
    }
    const now = new Date(), timestamp = Timestamp.fromDate(now);
    const audit = { verifiedBy: input.actorId, verifiedByName: actor.displayName || '',
      verificationProof: input.proof || null, adminNotes: input.notes || null, updatedAt: timestamp };
    if (input.action !== 'approve') {
      tx.update(recordRef, { ...audit, status: 'rejected', reviewAction: input.action });
      if (orderRef) {
        tx.update(orderRef, { ...audit, status: input.action === 'cancel' ? 'cancelled' : 'rejected' });
        writeMembershipPaymentStatus(db, tx, orderRef.id, {
          ...order, status: input.action === 'cancel' ? 'cancelled' : 'rejected', updatedAt: timestamp,
        });
        tx.delete(lockRef);
      }
      return { status: 'rejected' };
    }
    const gross = Number(record.requestedAmount);
    if (!Number.isFinite(gross) || gross <= 0 || Math.round(gross * 100) / 100 !== gross) throw new Error('INVALID_AMOUNT');
    if (input.actualAmount !== undefined && input.actualAmount !== gross) throw new Error('PAYMENT_AMOUNT_MISMATCH');
    // Ordinary manual reloads retain the existing whole-point conversion.
    const credit = order ? gross : Math.round(gross);
    // An ordinary reload cannot compete with an unresolved annual payment.
    if (!order && lock.exists) {
      const locked = await tx.get(db.collection(C.MEMBERSHIP_PAYMENTS).doc(lock.data()!.orderId));
      if (['creating', 'pending'].includes(locked.data()?.status)) throw new Error('MEMBERSHIP_PAYMENT_PENDING');
    }
    const userRef = db.collection(C.USERS).doc(record.userId);
    const userSnapshot = await tx.get(userRef);
    if (!userSnapshot.exists) throw new Error('USER_NOT_FOUND');
    const user = userSnapshot.data()!;
    const points = Number(user.membership?.points || 0);
    if (!Number.isFinite(points)) throw new Error('INVALID_POINTS_BALANCE');
    const fees = await tx.get(db.collection(C.MEMBERSHIP_FEE_RECORDS).where('userId', '==', record.userId));
    const renewal = fees.docs.some(doc => doc.data().status === 'paid' && Number(doc.data().amount) > 0);
    const feeConfig = await tx.get(db.collection(C.CONFIG).doc('membershipFee'));
    const fee = order ? Number(order.annualFee) : annualFee(feeConfig.data());
    if (!Number.isFinite(fee) || fee <= 0) throw new Error('INVALID_MEMBERSHIP_FEE');
    const initialPackage = order?.paymentMode === 'initial_package';
    const creditOnly = Boolean(order && input.creditOnly === true);
    if (order && (!['initial_package', 'renewal_reload'].includes(order.paymentMode)
      || (initialPackage ? (!creditOnly && renewal) || order.reloadAmount !== 100 || order.totalCents !== Math.round((fee + 100) * 100)
        : (!creditOnly && !renewal) || ![100, 200, 500].includes(order.reloadAmount) || order.totalCents !== order.reloadAmount * 100))) {
      throw new Error('MEMBERSHIP_REVIEW_REQUIRED');
    }
    const until = dateOf(user.membership?.activeUntil);
    const active = user.status === 'active' && (!until || until > now);
    const suspended = user.status === 'suspended';
    // A package that became active/suspended requires staff reconciliation, not a second activation.
    if (order && !creditOnly && (active || suspended || (until && until > now))) throw new Error('MEMBERSHIP_REVIEW_REQUIRED');

    const previousReloads = await tx.get(db.collection(C.RELOAD_RECORDS)
      .where('userId', '==', record.userId).where('status', '==', 'completed').limit(1));
    const pointsConfig = await tx.get(db.collection(C.CONFIG).doc('points'));
    const referrerId = user.referral?.referredByUserId;
    const referrerRef = referrerId && referrerId !== record.userId ? db.collection(C.USERS).doc(referrerId) : null;
    const referrerSnapshot = referrerRef ? await tx.get(referrerRef) : null;
    const rewards = pointsConfig.data()?.reload;
    const validReward = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
    const firstReload = previousReloads.empty && Boolean(referrerRef);
    const referredReward = firstReload ? validReward(rewards?.referredFirstReload) : 0;
    const referrerReward = firstReload && referrerSnapshot?.exists ? validReward(rewards?.referrerFirstReload) : 0;
    const creditBalance = Math.round((points + credit + referredReward) * 100) / 100;
    const activate = !creditOnly && (initialPackage || (renewal && !active && !suspended && (!until || until <= now) && creditBalance >= fee));
    const balance = Math.round((creditBalance - (activate ? fee : 0)) * 100) / 100;
    const nextUntil = new Date(now); nextUntil.setFullYear(nextUntil.getFullYear() + 1);
    const update: Record<string, unknown> = { 'membership.points': balance, updatedAt: timestamp,
      ...(user.role === 'guest' ? { role: 'member' } : {}) };
    if (activate) Object.assign(update, {
      status: 'active', role: ['guest', 'member', 'vip'].includes(user.role) ? 'vip' : user.role,
      'membership.activeFrom': timestamp, 'membership.activeUntil': Timestamp.fromDate(nextUntil),
      'membership.nextFirstVisitWaiverExpiresAt': null,
      ...(initialPackage ? { 'membership.firstActivatedAt': timestamp } : {}),
    });
    tx.update(userRef, update);
    const creditId = `manual_${input.recordId}_credit`;
    const ledger = { userId: record.userId, userName: user.displayName || '', relatedId: input.recordId,
      createdBy: input.actorId, createdAt: timestamp };
    tx.set(db.collection(C.POINTS_RECORDS).doc(creditId), {
      ...ledger, type: 'earn', amount: credit, source: 'reload', description: 'Verified manual payment', balance: points + credit,
    });
    if (referredReward) tx.set(db.collection(C.POINTS_RECORDS).doc(`manual_${input.recordId}_referred`), {
      ...ledger, type: 'earn', amount: referredReward, source: 'reload', description: 'First reload reward', balance: creditBalance,
    });
    if (referrerReward && referrerRef) {
      const referrer = referrerSnapshot!.data()!;
      const referrerPoints = Number(referrer.membership?.points || 0);
      if (!Number.isFinite(referrerPoints)) throw new Error('INVALID_POINTS_BALANCE');
      const referrals = [...(referrer.referral?.referrals || [])];
      const index = referrals.findIndex((r: any) => (typeof r === 'string' ? r : r.userId) === record.userId);
      const rewardData = { userId: record.userId, userName: user.displayName || '', memberId: user.memberId || null,
        firstReloadReward: referrerReward, firstReloadDate: timestamp, firstReloadRecordId: input.recordId };
      if (index < 0) referrals.push(rewardData);
      else referrals[index] = { ...(typeof referrals[index] === 'object' ? referrals[index] : {}), ...rewardData };
      tx.update(referrerRef, { 'membership.points': referrerPoints + referrerReward,
        'membership.referralPoints': calculateReferralPointsFromArray(referrals), 'referral.referrals': referrals, updatedAt: timestamp });
      tx.set(db.collection(C.POINTS_RECORDS).doc(`manual_${input.recordId}_referrer`), {
        ...ledger, userId: referrerId, userName: referrer.displayName || '', type: 'earn', amount: referrerReward,
        source: 'reload', description: 'Referral first reload reward', balance: referrerPoints + referrerReward,
      });
      tx.set(db.doc(`${C.USERS}/${referrerId}/referrals/${record.userId}`), {
        referredUserId: record.userId, referredUserName: user.displayName || '', firstReloadReward: referrerReward,
        firstReloadAt: timestamp, firstReloadRecordId: input.recordId, updatedAt: timestamp,
      }, { merge: true });
    }
    if (activate) {
      const feeRef = fees.docs.find(doc => doc.data().status === 'pending'
        && doc.data().renewalType === (initialPackage ? 'initial' : 'renewal'))?.ref
        || db.collection(C.MEMBERSHIP_FEE_RECORDS).doc(`manual_${input.recordId}`);
      const feePointsId = `manual_${input.recordId}_fee`;
      tx.set(db.collection(C.POINTS_RECORDS).doc(feePointsId), {
        ...ledger, type: 'spend', amount: fee, source: 'membership_fee', description: 'Annual Pass fee', balance,
      });
      tx.set(feeRef, { userId: record.userId, userName: user.displayName || '', amount: fee,
        renewalType: initialPackage ? 'initial' : 'renewal', status: 'paid', dueDate: timestamp,
        deductedAt: timestamp, pointsRecordId: feePointsId, storeId: record.storeId || null, createdAt: timestamp, updatedAt: timestamp });
      tx.set(db.collection(C.MEMBERSHIP_FEE_RECORDS).doc(`${feeRef.id}_renewal`), {
        userId: record.userId, userName: user.displayName || '', amount: fee, renewalType: 'renewal', status: 'pending',
        dueDate: Timestamp.fromDate(nextUntil), storeId: record.storeId || null, createdAt: timestamp, updatedAt: timestamp,
      });
      if (initialPackage && referrerRef) tx.set(db.doc(`${C.USERS}/${referrerId}/referrals/${record.userId}`), {
        referredUserId: record.userId, referredUserName: user.displayName || '',
        referredUserMemberId: user.memberId || null, membershipActivatedAt: timestamp, updatedAt: timestamp,
      }, { merge: true });
    }
    tx.update(recordRef, { ...audit, status: 'completed', verifiedAt: timestamp, actualAmount: gross,
      pointsEquivalent: credit, pointsRecordId: creditId, walletAmount: initialPackage && !creditOnly ? 100 : gross,
      annualFeeAmount: activate ? fee : 0, balance, membershipActivated: activate });
    if (orderRef) {
      tx.update(orderRef, { ...audit, status: activate ? 'fulfilled' : 'credited', balance, fulfilledAt: timestamp });
      writeMembershipPaymentStatus(db, tx, orderRef.id, { ...order, status: activate ? 'fulfilled' : 'credited', updatedAt: timestamp });
      tx.delete(lockRef);
    }
    return { status: 'completed', balance };
  });
}
