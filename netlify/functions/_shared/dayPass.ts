import type { Firestore, Timestamp, Transaction } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';

const validId = (id: unknown): id is string => typeof id === 'string' && id.trim().length > 0
  && id.length <= 128 && !/[\u0000-\u001f/]/.test(id) && id !== '.' && id !== '..';
const operators = ['admin', 'superAdmin', 'developer', 'storeAdmin'];

async function operatorRole(tx: Transaction, db: Firestore, uid: string) {
  const direct = await tx.get(db.collection(C.USERS).doc(uid));
  if (direct.exists) return direct.data()?.role;
  const linked = await tx.get(db.collection(C.USERS).where('authUid', '==', uid).limit(2));
  return linked.size === 1 ? linked.docs[0].data().role : undefined;
}

export async function executeDayPass(db: Firestore, uid: string, input: any, now: Timestamp): Promise<{
  enabled?: boolean; sessionId?: string; alreadyPurchased?: boolean;
}> {
  const configRef = db.collection(C.CONFIG).doc('points');
  if (input.action === 'set-enabled') {
    if (typeof input.enabled !== 'boolean') throw new Error('invalid-request');
    const auditRef = db.collection(C.AUDIT_LOGS).doc();
    return db.runTransaction(async tx => {
      const role = await operatorRole(tx, db, uid);
      const config = await tx.get(configRef);
      if (!['superAdmin', 'developer'].includes(role)) throw new Error('forbidden');
      const previous = config.data()?.dayPass?.enabled !== false;
      if (previous !== input.enabled) {
        if (config.exists) tx.update(configRef, { 'dayPass.enabled': input.enabled, updatedAt: now, updatedBy: uid });
        else tx.set(configRef, {
          purchase: { perRinggit: 1, rebatePercent: 0 }, reload: { referrerFirstReload: 0, referredFirstReload: 0 },
          event: { registration: 10 }, visit: { hourlyRate: 10 },
          dayPass: { enabled: input.enabled, cost: 100, freeHours: 3, hourlyRateAfter: 30, cigarAllowance: 1 },
          updatedAt: now, updatedBy: uid,
        });
        tx.set(auditRef, { action: 'day-pass-toggle', userId: uid, before: previous, after: input.enabled, createdAt: now });
      }
      return { enabled: input.enabled };
    });
  }
  if (!validId(input.userId) || !validId(input.storeId) || !validId(input.requestId)
    || (input.sessionId !== undefined && !validId(input.sessionId))) throw new Error('invalid-request');
  const userRef = db.collection(C.USERS).doc(input.userId);
  const storeRef = db.collection(C.STORES).doc(input.storeId);
  const newSessionRef = db.collection(C.VISIT_SESSIONS).doc(`daypass_${input.userId}_${input.requestId}`);
  return db.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);
    const isOwner = userSnap.data()?.authUid ? userSnap.data()?.authUid === uid : input.userId === uid;
    const role = isOwner ? undefined : await operatorRole(tx, db, uid);
    const configSnap = await tx.get(configRef);
    const storeSnap = await tx.get(storeRef);
    if (!userSnap.exists) throw new Error('member-not-found');
    const user = userSnap.data()!;
    if (!isOwner && !operators.includes(role)) throw new Error('forbidden');
    if (user.status === 'suspended') throw new Error('account-suspended');
    if (!storeSnap.exists) throw new Error('lounge-not-found');

    // Serialize purchases through the user document, including clients without a session ID.
    const pending = await tx.get(db.collection(C.VISIT_SESSIONS).where('userId', '==', input.userId).where('status', '==', 'pending'));
    const existingId = user.membership?.currentVisitSessionId || pending.docs[0]?.id;
    if (input.sessionId && existingId && input.sessionId !== existingId) throw new Error('invalid-session');
    const sessionRef = input.sessionId || existingId
      ? db.collection(C.VISIT_SESSIONS).doc(input.sessionId || existingId) : newSessionRef;
    const sessionSnap = await tx.get(sessionRef);
    const session = sessionSnap.data();
    const redemptionRef = db.collection(C.REDEMPTION_RECORDS).doc(sessionRef.id);
    const redemptionSnap = await tx.get(redemptionRef);
    if (session && (session.userId !== input.userId || session.storeId !== input.storeId)) throw new Error('invalid-session');
    if (session?.dayPass?.isPurchased) return { sessionId: sessionRef.id, alreadyPurchased: true };
    if (session && (session.status !== 'pending' || session.checkInType === 'membership')) throw new Error('invalid-session');
    if (configSnap.data()?.dayPass?.enabled === false) throw new Error('disabled');
    const raw = configSnap.data()?.dayPass || {};
    const config = { cost: raw.cost ?? 100, freeHours: raw.freeHours ?? 3, hourlyRateAfter: raw.hourlyRateAfter ?? 30, cigarAllowance: raw.cigarAllowance ?? 1 };
    if (!Object.values(config).every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)
      || config.cost <= 0 || !Number.isInteger(config.cigarAllowance) || config.cigarAllowance > 100) throw new Error('invalid-config');
    const balance = Number(user.membership?.points ?? 0);
    if (!Number.isFinite(balance) || balance < config.cost) throw new Error('insufficient-points');
    const store = storeSnap.data()!;
    const userName = user.displayName || '';
    const date = now.toDate().toISOString();
    const entitlement = config.cigarAllowance > 0 ? [{
      id: `daypass_${sessionRef.id}`, userId: input.userId, userName,
      cigarId: '', cigarName: '待选择 (Day Pass 赠送)', quantity: config.cigarAllowance,
      status: 'pending', dayKey: date.slice(0, 10), hourKey: date.split(':')[0],
      redemptionIndex: 1, isDayPass: true, redeemedAt: now, redeemedBy: uid, createdAt: now,
    }] : [];
    const sessionEntitlements = entitlement.map(item => ({
      recordId: item.id, cigarId: item.cigarId, cigarName: item.cigarName, quantity: item.quantity,
      redeemedBy: uid, redeemedAt: now,
    }));
    const newBalance = balance - config.cost;
    tx.update(userRef, { 'membership.points': newBalance, 'membership.currentVisitSessionId': sessionRef.id,
      ...(!session && { 'membership.lastCheckInAt': now }), updatedAt: now });
    tx.set(sessionRef, {
      ...(!session && { userId: input.userId, userName, storeId: input.storeId, storeName: store.name || '',
        checkInAt: now, checkInBy: uid, status: 'pending', createdAt: now }),
      checkInType: 'daypass', dayPass: { isPurchased: true, purchasedAt: now, config },
      redemptions: [...(session?.redemptions || []), ...sessionEntitlements], updatedAt: now,
    }, { merge: true });
    tx.set(db.collection(C.POINTS_RECORDS).doc(`daypass_${sessionRef.id}`), {
      userId: input.userId, userName, type: 'spend', amount: config.cost, source: 'visit',
      description: '购买 Day Pass', relatedId: sessionRef.id, balance: newBalance, createdBy: uid, createdAt: now,
    });
    if (entitlement.length) tx.set(redemptionRef, { visitSessionId: sessionRef.id, userId: input.userId, userName,
      redemptions: [...(redemptionSnap.data()?.redemptions || []), ...entitlement],
      ...(!redemptionSnap.exists && { createdAt: now }), updatedAt: now }, { merge: true });
    return { sessionId: sessionRef.id, alreadyPurchased: false };
  });
}
