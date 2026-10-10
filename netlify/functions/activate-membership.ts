import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Timestamp, getFirestore } from './_shared/firestoreMonitoring';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

const initializeAdmin = () => {
  if (getApps().length) return;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) throw new Error('SERVICE_UNAVAILABLE');

  try {
    initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
  } catch (error) {
    console.error('[activate-membership] Firebase Admin initialization failed', error);
    throw new Error('SERVICE_UNAVAILABLE');
  }
};

const toDate = (value: unknown): Date | null => {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const getAnnualFeeAmount = (annualFees: any[], targetDate: Date): number => {
  const matchingFees = annualFees
    .map(fee => ({
      ...fee,
      startDate: toDate(fee.startDate),
      endDate: toDate(fee.endDate),
    }))
    .filter(fee => fee.startDate && fee.startDate <= targetDate && (!fee.endDate || fee.endDate >= targetDate))
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

  return Number(matchingFees[0]?.amount || 150);
};

const getAuthenticatedUser = async (authorization?: string) => {
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  if (!token) throw new Error('UNAUTHENTICATED');

  initializeAdmin();
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(token);
  } catch {
    throw new Error('UNAUTHENTICATED');
  }
  const db = getFirestore();
  let userSnapshot = await db.collection('users').doc(decoded.uid).get();

  // Legacy accounts may have a Firestore document ID different from Auth UID.
  if (!userSnapshot.exists && decoded.email) {
    const matches = await db.collection('users')
      .where('email', '==', decoded.email.toLowerCase())
      .limit(1)
      .get();
    userSnapshot = matches.docs[0] || userSnapshot;
  }

  if (!userSnapshot.exists) throw new Error('USER_NOT_FOUND');
  return userSnapshot;
};

export const eventHandler: Handler = async event => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST') return reply(405, { success: false, error: 'Method not allowed' });

  try {
    const userSnapshot = await getAuthenticatedUser(event.headers.authorization);
    const db = getFirestore();
    let body: Record<string, unknown> = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch {
        throw new Error('INVALID_REQUEST');
      }
    }
    const storeId = typeof body.storeId === 'string' && body.storeId.trim()
      ? body.storeId.trim()
      : null;

    const pendingSnapshot = await db.collection('membershipFeeRecords')
      .where('userId', '==', userSnapshot.id)
      .limit(50)
      .get();
    const pendingRecord = pendingSnapshot.docs
      .filter(doc => doc.data().status === 'pending')
      .sort((a, b) => {
        const typeOrder = (value: string) => value === 'renewal' ? 0 : 1;
        const typeDifference = typeOrder(a.data().renewalType) - typeOrder(b.data().renewalType);
        if (typeDifference !== 0) return typeDifference;
        return (toDate(a.data().dueDate)?.getTime() || 0) - (toDate(b.data().dueDate)?.getTime() || 0);
      })[0];

    const activationDate = new Date().toISOString().slice(0, 10);
    const recordRef = pendingRecord?.ref
      || db.collection('membershipFeeRecords').doc(`activation_${userSnapshot.id}_${activationDate}`);
    const nextRecordRef = db.doc(`membershipFeeRecords/${recordRef.id}_renewal`);
    const configRef = db.doc('config/membershipFee');

    const result = await db.runTransaction(async transaction => {
      const [freshUserSnapshot, configSnapshot, recordSnapshot, nextRecordSnapshot] = await Promise.all([
        transaction.get(userSnapshot.ref),
        transaction.get(configRef),
        transaction.get(recordRef),
        transaction.get(nextRecordRef),
      ]);

      if (!freshUserSnapshot.exists) throw new Error('USER_NOT_FOUND');
      const user = freshUserSnapshot.data()!;
      if (user.status === 'active') throw new Error('ALREADY_ACTIVE');
      if (user.status === 'suspended') throw new Error('ACCOUNT_SUSPENDED');

      const now = new Date();
      const nowTimestamp = Timestamp.fromDate(now);
      const amount = getAnnualFeeAmount(configSnapshot.data()?.annualFees || [], now);
      const currentPoints = Number(user.membership?.points || 0);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_MEMBERSHIP_FEE');
      if (currentPoints < amount) {
        const error = new Error('INSUFFICIENT_POINTS') as Error & { details?: Record<string, number> };
        error.details = { required: amount, current: currentPoints };
        throw error;
      }

      if (recordSnapshot.exists && recordSnapshot.data()?.status !== 'pending') {
        throw new Error('MEMBERSHIP_RECORD_ALREADY_PROCESSED');
      }

      const recordedType = recordSnapshot.data()?.renewalType;
      const renewalType = recordedType === 'initial' || recordedType === 'renewal'
        ? recordedType
        : user.membership?.activeFrom || user.membership?.activeUntil ? 'renewal' : 'initial';
      const newPoints = currentPoints - amount;
      const activeUntil = new Date(now);
      activeUntil.setFullYear(activeUntil.getFullYear() + 1);
      const pointsRecordRef = db.collection('pointsRecords').doc();

      const userUpdate: Record<string, unknown> = {
        'membership.points': newPoints,
        'membership.activeFrom': nowTimestamp,
        'membership.activeUntil': Timestamp.fromDate(activeUntil),
        status: 'active',
        role: ['guest', 'member'].includes(user.role) ? 'vip' : user.role,
        updatedAt: nowTimestamp,
      };

      if (renewalType === 'renewal') {
        const waiverExpiresAt = new Date(now);
        waiverExpiresAt.setDate(waiverExpiresAt.getDate() + 30);
        userUpdate['membership.nextFirstVisitWaiverExpiresAt'] = Timestamp.fromDate(waiverExpiresAt);
      }

      transaction.update(freshUserSnapshot.ref, userUpdate);
      transaction.set(pointsRecordRef, {
        userId: freshUserSnapshot.id,
        userName: user.displayName || '',
        type: 'spend',
        amount,
        source: 'membership_fee',
        description: `Annual Pass (${renewalType})`,
        relatedId: recordRef.id,
        balance: newPoints,
        createdBy: 'membership-activation',
        createdAt: nowTimestamp,
      });
      transaction.set(recordRef, {
        userId: freshUserSnapshot.id,
        userName: user.displayName || '',
        amount,
        dueDate: recordSnapshot.data()?.dueDate || nowTimestamp,
        previousDueDate: recordSnapshot.data()?.previousDueDate || null,
        renewalType,
        status: 'paid',
        storeId: storeId || recordSnapshot.data()?.storeId || null,
        deductedAt: nowTimestamp,
        pointsRecordId: pointsRecordRef.id,
        createdAt: recordSnapshot.data()?.createdAt || nowTimestamp,
        updatedAt: nowTimestamp,
      }, { merge: false });

      if (!nextRecordSnapshot.exists) {
        transaction.set(nextRecordRef, {
          userId: freshUserSnapshot.id,
          userName: user.displayName || '',
          amount: getAnnualFeeAmount(configSnapshot.data()?.annualFees || [], activeUntil),
          dueDate: Timestamp.fromDate(activeUntil),
          renewalType: 'renewal',
          previousDueDate: recordSnapshot.data()?.dueDate || nowTimestamp,
          status: 'pending',
          storeId: storeId || recordSnapshot.data()?.storeId || null,
          createdAt: nowTimestamp,
          updatedAt: nowTimestamp,
        });
      }

      if (renewalType === 'initial' && user.referral?.referredByUserId) {
        const referralRef = db.doc(`users/${user.referral.referredByUserId}/referrals/${freshUserSnapshot.id}`);
        transaction.set(referralRef, {
          referredUserId: freshUserSnapshot.id,
          referredUserName: user.displayName || '',
          referredUserMemberId: user.memberId || null,
          membershipActivatedAt: nowTimestamp,
          createdAt: user.referral.referralDate || nowTimestamp,
          updatedAt: nowTimestamp,
        }, { merge: true });
      }

      return { amount, balance: newPoints, activeUntil: activeUntil.toISOString() };
    });

    return reply(200, { success: true, ...result });
  } catch (error: any) {
    const code = error?.message || 'ACTIVATION_FAILED';
    if (error?.code === 8 || String(code).includes('RESOURCE_EXHAUSTED')) {
      console.error('[activate-membership] Firestore quota exceeded', error);
      return reply(503, { success: false, code: 'FIRESTORE_QUOTA_EXCEEDED' });
    }
    if (code === 'UNAUTHENTICATED') return reply(401, { success: false, code });
    if (code === 'USER_NOT_FOUND') return reply(404, { success: false, code });
    if (code === 'ALREADY_ACTIVE' || code === 'ACCOUNT_SUSPENDED' || code === 'MEMBERSHIP_RECORD_ALREADY_PROCESSED') {
      return reply(409, { success: false, code });
    }
    if (code === 'INSUFFICIENT_POINTS') {
      return reply(400, { success: false, code, ...error.details });
    }
    if (code === 'INVALID_REQUEST') return reply(400, { success: false, code });
    if (code === 'SERVICE_UNAVAILABLE' || code === 'INVALID_MEMBERSHIP_FEE') {
      return reply(503, { success: false, code: 'SERVICE_UNAVAILABLE' });
    }
    console.error('[activate-membership]', error);
    return reply(500, { success: false, code: 'ACTIVATION_FAILED' });
  }
};

export default toWebFunction(eventHandler)
