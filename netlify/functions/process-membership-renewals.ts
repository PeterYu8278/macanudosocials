import { schedule } from '@netlify/functions';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

const getAdminDb = () => {
  if (!getApps().length) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawServiceAccount) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
    }

    initializeApp({ credential: cert(JSON.parse(rawServiceAccount)) });
  }

  return getFirestore();
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

  return matchingFees[0]?.amount || 150;
};

const processRenewals = async () => {
  const db = getAdminDb();
  const now = new Date();
  const nowTimestamp = Timestamp.fromDate(now);
  const configSnapshot = await db.doc('config/membershipFee').get();
  const annualFees = configSnapshot.data()?.annualFees || [];
  const dueRecords = await db.collection('membershipFeeRecords')
    .where('status', '==', 'pending')
    .where('dueDate', '<=', nowTimestamp)
    .orderBy('dueDate', 'asc')
    .limit(500)
    .get();

  const result = { scanned: dueRecords.size, paid: 0, insufficient: 0, skipped: 0, errors: [] as string[] };

  for (const dueRecord of dueRecords.docs) {
    try {
      const outcome = await db.runTransaction(async transaction => {
        const recordRef = dueRecord.ref;
        const recordSnapshot = await transaction.get(recordRef);
        if (!recordSnapshot.exists || recordSnapshot.data()?.status !== 'pending') return 'skipped';

        const record = recordSnapshot.data()!;
        const userRef = db.doc(`users/${record.userId}`);
        const userSnapshot = await transaction.get(userRef);
        if (!userSnapshot.exists) throw new Error(`User ${record.userId} not found`);

        const user = userSnapshot.data()!;
        const amount = Number(record.amount || 0);
        const currentPoints = Number(user.membership?.points || 0);

        if (amount <= 0) throw new Error('Invalid membership fee amount');

        if (currentPoints < amount) {
          transaction.update(userRef, {
            status: 'inactive',
            updatedAt: nowTimestamp,
          });
          transaction.update(recordRef, {
            lastAttemptAt: nowTimestamp,
            lastAttemptResult: 'insufficient_points',
            updatedAt: nowTimestamp,
          });
          return 'insufficient';
        }

        const nextDueDate = new Date(now);
        nextDueDate.setFullYear(nextDueDate.getFullYear() + 1);
        const nextRecordRef = db.doc(`membershipFeeRecords/${recordSnapshot.id}_renewal`);
        const nextRecordSnapshot = await transaction.get(nextRecordRef);
        const pointsRecordRef = db.collection('pointsRecords').doc();
        const newPoints = currentPoints - amount;
        const userUpdate: Record<string, unknown> = {
          'membership.points': newPoints,
          status: 'active',
          role: user.role === 'guest' ? 'member' : user.role,
          updatedAt: nowTimestamp,
        };

        if (record.renewalType === 'renewal') {
          const waiverExpiresAt = new Date(now);
          waiverExpiresAt.setDate(waiverExpiresAt.getDate() + 30);
          userUpdate['membership.nextFirstVisitWaiverExpiresAt'] = Timestamp.fromDate(waiverExpiresAt);
        }

        transaction.update(userRef, userUpdate);
        transaction.set(pointsRecordRef, {
          userId: record.userId,
          userName: record.userName || user.displayName || '',
          type: 'spend',
          amount,
          source: 'membership_fee',
          description: `Annual Pass (${record.renewalType === 'initial' ? 'initial' : 'renewal'})`,
          relatedId: recordSnapshot.id,
          balance: newPoints,
          createdBy: 'scheduled-renewal',
          createdAt: nowTimestamp,
        });
        transaction.update(recordRef, {
          status: 'paid',
          deductedAt: nowTimestamp,
          pointsRecordId: pointsRecordRef.id,
          lastAttemptAt: nowTimestamp,
          lastAttemptResult: 'paid',
          updatedAt: nowTimestamp,
        });

        if (!nextRecordSnapshot.exists) {
          transaction.set(nextRecordRef, {
            userId: record.userId,
            userName: record.userName || user.displayName || '',
            amount: getAnnualFeeAmount(annualFees, nextDueDate),
            dueDate: Timestamp.fromDate(nextDueDate),
            renewalType: 'renewal',
            previousDueDate: record.dueDate || null,
            status: 'pending',
            storeId: record.storeId || null,
            createdAt: nowTimestamp,
            updatedAt: nowTimestamp,
          });
        }

        if (record.renewalType === 'initial' && user.referral?.referredByUserId) {
          const referralRef = db.doc(`users/${user.referral.referredByUserId}/referrals/${record.userId}`);
          transaction.set(referralRef, {
            referredUserId: record.userId,
            referredUserName: record.userName || user.displayName || '',
            referredUserMemberId: user.memberId || null,
            membershipActivatedAt: nowTimestamp,
            createdAt: user.referral.referralDate || nowTimestamp,
            updatedAt: nowTimestamp,
          }, { merge: true });
        }

        return 'paid';
      });

      if (outcome === 'paid') result.paid++;
      else if (outcome === 'insufficient') result.insufficient++;
      else result.skipped++;
    } catch (error: any) {
      result.errors.push(`${dueRecord.id}: ${error.message || 'Unknown error'}`);
    }
  }

  console.log('[process-membership-renewals]', result);
  return { statusCode: result.errors.length ? 207 : 200, body: JSON.stringify(result) };
};

// Netlify cron uses UTC; 16:05 UTC is 00:05 in Singapore.
export const handler = schedule('5 16 * * *', processRenewals);
