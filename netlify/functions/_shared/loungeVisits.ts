import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';
import { firstVisitCutoff, loungeAvailability, visitChargeQuote } from '../../../src/utils/loungeOperations';
import { visitRedemptionStockOutReason } from '../../../src/utils/inventoryReason';

export const loungeError = (code: string, details = {}) => Object.assign(new Error(code), { details });
export const asDate = (value: any): Date => value?.toDate?.() || new Date(value);
const amount = (n: any) => { if (typeof n !== 'number' || !Number.isFinite(n)) throw loungeError('invalid-billing'); return n; };
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function hourlyRate(config: any, at: Date): number {
  const fees = [...(config?.annualFees || [])].sort((a, b) => asDate(b.startDate).getTime() - asDate(a.startDate).getTime());
  const fee = fees.find(item => asDate(item.startDate) <= at && (!item.endDate || asDate(item.endDate) >= at));
  const rate = fee?.rate ?? fees[0]?.rate ?? 25;
  if (amount(rate) < 0) throw loungeError('invalid-billing');
  return rate;
}

export async function authorizeLounge(tx: any, db: Firestore, uid: string, userId: string, storeId: string, adminOnly = false) {
  const member = (await tx.get(db.collection(C.USERS).doc(userId))).data();
  let operator = (await tx.get(db.collection(C.USERS).doc(uid))).data();
  if (!operator) {
    const linked = await tx.get(db.collection(C.USERS).where('authUid', '==', uid).limit(2));
    if (linked.size === 1) operator = linked.docs[0].data();
  }
  const global = ['developer', 'superAdmin'].includes(operator?.role);
  const admin = global || ['admin', 'storeAdmin'].includes(operator?.role) && operator?.storeId === storeId;
  const owner = member && (member.authUid ? member.authUid === uid : userId === uid);
  if (!admin && (adminOnly || !owner)) throw loungeError('forbidden');
  if (!member && !(adminOnly && userId === uid && admin)) throw loungeError('member-not-found');
  return member || operator;
}

export async function checkInLounge(db: Firestore, uid: string, input: { userId: string; storeId: string; requestId: string }, now: Date) {
  const sessionRef = db.collection(C.VISIT_SESSIONS).doc(`checkin_${input.userId}_${input.requestId}`);
  return db.runTransaction(async tx => {
    const member = await authorizeLounge(tx, db, uid, input.userId, input.storeId);
    const store = (await tx.get(db.collection(C.STORES).doc(input.storeId))).data();
    const fee = (await tx.get(db.collection(C.CONFIG).doc('membershipFee'))).data();
    const existing = await tx.get(sessionRef);
    const pending = await tx.get(db.collection(C.VISIT_SESSIONS).where('userId', '==', input.userId).where('status', '==', 'pending').limit(2));
    if (existing.exists) {
      if (existing.data()?.storeId !== input.storeId) throw loungeError('request-conflict');
      return { sessionId: sessionRef.id };
    }
    if (!store || store.status !== 'active') throw loungeError('lounge-unavailable');
    if (!store.operations?.enabled) throw loungeError('not-enabled');
    const available = loungeAvailability(store.operations, now);
    if (!available.allowed) throw loungeError('outside-hours', { nextOpen: available.nextOpen });
    if (pending.size || member.membership?.currentVisitSessionId) throw loungeError('already-checked-in');
    if (member.status !== 'active') throw loungeError('membership-inactive');
    const waived = member.membership?.nextFirstVisitWaiverExpiresAt && asDate(member.membership.nextFirstVisitWaiverExpiresAt) >= now;
    const rate = hourlyRate(fee, now), charge = waived ? 0 : rate;
    const before = amount(member.membership?.points ?? 0), balance = money(before - charge);
    if (balance < 0) throw loungeError('insufficient-checkin', { currentPoints: before, pointsDue: charge, shortfall: -balance });
    const stamp = Timestamp.fromDate(now), cutoff = Timestamp.fromDate(firstVisitCutoff(now)), recordedAt = Timestamp.now();
    tx.create(sessionRef, { userId: input.userId, userName: member.displayName || '', storeId: input.storeId, storeName: store.name,
      checkInAt: stamp, checkInBy: uid, status: 'pending', checkInType: 'membership', createdAt: stamp, updatedAt: stamp,
      managedClosing: true, scheduledCheckOutAt: cutoff, hourlyRateSnapshot: rate, isFirstVisitAfterRenewal: !!waived,
      realtimeDeductionsEnabled: !waived, realtimePointsDeducted: charge, deductionCount: waived ? 0 : 1,
      nextDeductionAt: Timestamp.fromMillis(now.getTime() + 3600000) });
    tx.update(db.collection(C.USERS).doc(input.userId), { 'membership.points': balance,
      'membership.totalVisitHours': amount(member.membership?.totalVisitHours ?? 0) + (waived ? 0 : 1),
      'membership.currentVisitSessionId': sessionRef.id, 'membership.lastCheckInAt': stamp, updatedAt: stamp });
    if (charge) tx.create(db.collection(C.POINTS_RECORDS).doc(`visit-${sessionRef.id}-initial`), {
      userId: input.userId, storeId: input.storeId, userName: member.displayName || '', type: 'spend', amount: charge,
      source: 'visit', relatedId: sessionRef.id, balance, balanceBefore: before, createdAt: recordedAt, effectiveAt: stamp,
      createdBy: uid, description: 'Visit first-hour charge' });
    return { sessionId: sessionRef.id };
  });
}

export async function settleLoungeVisit(db: Firestore, sessionId: string, at: Date, options: { uid?: string; automatic?: boolean; forceHours?: number; preview?: boolean } = {}) {
  const ref = db.collection(C.VISIT_SESSIONS).doc(sessionId);
  const result = await db.runTransaction(async tx => {
    const snapshot = await tx.get(ref), session = snapshot.data();
    if (!session) throw loungeError('session-not-found');
    const store = (await tx.get(db.collection(C.STORES).doc(session.storeId))).data();
    if (!store?.operations?.enabled) throw loungeError('not-enabled');
    const userRef = db.collection(C.USERS).doc(session.userId);
    const member = options.uid ? await authorizeLounge(tx, db, options.uid, session.userId, session.storeId, true) : (await tx.get(userRef)).data();
    if (!member) throw loungeError('member-not-found');
    const fee = (await tx.get(db.collection(C.CONFIG).doc('membershipFee'))).data();
    const points = (await tx.get(db.collection(C.CONFIG).doc('points'))).data();
    if (session.status !== 'pending' || session.checkOutAt) return { status: 'completed', alreadyCompleted: true, pointsDeducted: session.pointsDeducted || 0, rebatePoints: session.rebatePoints || 0 };
    const checkIn = asDate(session.checkInAt), closing = firstVisitCutoff(checkIn);
    if (!Number.isFinite(checkIn.getTime())) throw loungeError('invalid-session');
    const cutoff = new Date(Math.min(at.getTime(), closing.getTime()));
    const pending = session.checkoutPending;
    const effective = pending?.requestedAt && asDate(pending.requestedAt) < cutoff ? asDate(pending.requestedAt) : cutoff;
    const forceHours = pending?.forceHours ?? options.forceHours;
    if (forceHours !== undefined && (!Number.isFinite(forceHours) || forceHours < 0 || forceHours > 168)) throw loungeError('invalid-request');
    const quote = visitChargeQuote({ ...session, checkInAt: checkIn,
      hourlyRate: session.hourlyRateSnapshot ?? hourlyRate(fee, checkIn), checkoutPending: null },
      forceHours !== undefined ? new Date(Math.min(effective.getTime(), checkIn.getTime() + forceHours * 3600000)) : effective);
    const before = amount(member.membership?.points ?? 0), due = money(quote.due), charged = money(before - due);
    const rebatePercent = amount(points?.purchase?.rebatePercent ?? 0);
    if (rebatePercent < 0 || rebatePercent > 100) throw loungeError('invalid-billing');
    const rebate = Math.round(quote.total * rebatePercent / 100), balance = money(charged + rebate);
    if (!options.automatic && at < closing && charged < 0) {
      if (!options.preview) tx.update(ref, { checkoutPending: { status: 'awaiting_reload', pointsDueNow: due, shortfall: -charged,
        durationMinutes: quote.minutes, durationHours: quote.hours, requestedAt: Timestamp.fromDate(effective), requestedBy: options.uid || 'system',
        ...(forceHours !== undefined ? { forceHours } : {}) }, updatedAt: Timestamp.fromDate(at) });
      return { status: 'insufficient', currentPoints: before, pointsDue: due, shortfall: -charged };
    }
    if (options.preview) return { status: 'preview', pointsDeducted: quote.total, rebatePoints: rebate, balance, checkOutAt: effective.toISOString() };
    const stamp = Timestamp.now(), effectiveAt = Timestamp.fromDate(effective);
    const operator = options.automatic ? 'system' : options.uid || 'system';
    tx.update(userRef, { 'membership.points': balance,
      ...(member.membership?.currentVisitSessionId === sessionId ? { 'membership.currentVisitSessionId': null } : {}),
      'membership.totalVisitHours': Math.max(0, amount(member.membership?.totalVisitHours ?? 0) + quote.hoursAdjustment), updatedAt: stamp });
    tx.create(db.collection(C.POINTS_RECORDS).doc(`visit-${sessionId}-closing`), {
      userId: session.userId, userName: member.displayName || '', storeId: session.storeId, type: due < 0 ? 'earn' : 'spend', amount: Math.abs(due),
      source: 'visit', relatedId: sessionId, balanceBefore: before, balance: charged, createdAt: stamp, effectiveAt,
      createdBy: operator, description: 'Visit final settlement', closingCharge: true });
    if (rebate) tx.create(db.collection(C.POINTS_RECORDS).doc(`visit-${sessionId}-rebate`), {
      userId: session.userId, userName: member.displayName || '', storeId: session.storeId, type: 'earn', amount: rebate,
      source: 'visit', relatedId: sessionId, balanceBefore: charged, balance, createdAt: stamp, effectiveAt,
      createdBy: operator, description: 'Visit rebate' });
    tx.update(ref, { checkOutAt: effectiveAt, checkOutBy: operator, checkoutSource: options.automatic || at >= closing ? 'automatic_2300' : 'manual',
      durationMinutes: quote.minutes, durationHours: quote.billedHours, actualDurationHours: quote.hours,
      pointsDeducted: quote.total, pointsRecordId: `visit-${sessionId}-closing`, rebatePoints: rebate,
      rebatePointsRecordId: rebate ? `visit-${sessionId}-rebate` : null, settlementStatus: 'completed', settledAt: stamp,
      checkoutPending: null, status: 'completed', realtimeDeductionsEnabled: false, updatedAt: stamp,
      inventorySettlementStatus: 'pending' });
    tx.create(db.collection(C.AUDIT_LOGS).doc(`checkout-${sessionId}`), { action: 'visit-checkout', sessionId, storeId: session.storeId,
      operatorId: operator, before, after: balance, due, rebate, effectiveAt, createdAt: stamp });
    return { status: 'completed', pointsDeducted: quote.total, rebatePoints: rebate };
  });
    if (result.status === 'completed' && !options.preview) await syncLoungeRedemptions(db, sessionId);
  return result;
}

export async function syncLoungeRedemptions(db: Firestore, sessionId: string) {
  return db.runTransaction(async tx => {
    const ref = db.collection(C.VISIT_SESSIONS).doc(sessionId), session = (await tx.get(ref)).data();
    if (session?.status !== 'completed') return;
    const source = (await tx.get(db.collection(C.REDEMPTION_RECORDS).doc(sessionId))).data();
    const confirmed = (source?.redemptions || []).filter((item: any) => item.status === 'completed' && item.cigarId && item.cigarId !== 'referral_reward' && item.type !== 'referral_reward');
    const quantities = new Map<string, number>();
    for (const item of confirmed) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw loungeError('invalid-redemption');
      quantities.set(item.cigarId, (quantities.get(item.cigarId) || 0) + item.quantity);
    }
    if (quantities.size > 100) throw loungeError('invalid-redemption');
    const items = [];
    for (const [cigarId, quantity] of quantities) {
      const cigar = (await tx.get(db.collection(C.CIGARS).doc(cigarId))).data();
      if (!cigar) throw loungeError('cigar-not-found');
      const unitPrice = amount(cigar.price ?? 0);
      items.push({ cigarId, cigarName: cigar.name || '', itemType: 'cigar', quantity, unitPrice, subtotal: money(unitPrice * quantity) });
    }
    const orderId = session.orderId || `REDEMPTION-${sessionId}`, outboundId = session.outboundOrderId || `REDEMPTION-${sessionId}`;
    const orderRef = db.collection(C.ORDERS).doc(orderId), outboundRef = db.collection(C.OUTBOUND_ORDERS).doc(outboundId);
    const oldOrder = await tx.get(orderRef), oldOutbound = await tx.get(outboundRef);
    const movements = await tx.get(db.collection(C.INVENTORY_MOVEMENTS).where('outboundOrderId', '==', outboundId));
    const now = Timestamp.now();
    if (movements.size > 200) throw loungeError('invalid-redemption');
    if (items.length) {
      tx.set(orderRef, { userId: session.userId, userName: session.userName || '', storeId: session.storeId,
        items: items.map(item => ({ cigarId: item.cigarId, quantity: item.quantity, price: 0 })), total: 0, status: 'completed',
        source: { type: 'direct', note: `Visit redemption (Session: ${sessionId})` },
        payment: { method: 'bank_transfer', paidAt: session.checkOutAt }, shipping: { address: 'In-store redemption' },
        createdAt: oldOrder.data()?.createdAt || session.checkOutAt, updatedAt: now }, { merge: true });
      tx.set(outboundRef, { referenceNo: orderId, type: 'sale', reason: visitRedemptionStockOutReason(sessionId), items,
        totalQuantity: items.reduce((n, item) => n + item.quantity, 0), totalValue: money(items.reduce((n, item) => n + item.subtotal, 0)),
        orderId, userId: session.userId, userName: session.userName || '', storeId: session.storeId, status: 'completed',
        operatorId: session.checkOutBy || 'system', createdAt: oldOutbound.data()?.createdAt || session.checkOutAt, updatedAt: now }, { merge: true });
      movements.docs.forEach(doc => tx.delete(doc.ref));
      for (const item of items) tx.set(db.collection(C.INVENTORY_MOVEMENTS).doc(`${outboundId}-${item.cigarId}`), {
        ...item, type: 'out', referenceNo: orderId, orderType: 'outbound', outboundOrderId: outboundId,
        reason: visitRedemptionStockOutReason(sessionId), storeId: session.storeId, createdAt: session.checkOutAt });
    }
    tx.update(ref, { ...(items.length ? { orderId, outboundOrderId: outboundId } : {}), inventorySettlementStatus: 'completed', updatedAt: now });
  });
}

export async function deductLoungeRealtime(db: Firestore, sessionId: string, uid: string, now: Date) {
  const ref = db.collection(C.VISIT_SESSIONS).doc(sessionId);
  const result = await db.runTransaction(async tx => {
    const session = (await tx.get(ref)).data();
    if (!session) throw loungeError('session-not-found');
    const member = await authorizeLounge(tx, db, uid, session.userId, session.storeId);
    const store = (await tx.get(db.collection(C.STORES).doc(session.storeId))).data();
    const fee = (await tx.get(db.collection(C.CONFIG).doc('membershipFee'))).data();
    if (!store?.operations?.enabled) throw loungeError('not-enabled');
    if (session.status !== 'pending' || session.checkOutAt) return { deducted: 0, count: 0 };
    const checkIn = asDate(session.checkInAt);
    if (now >= firstVisitCutoff(checkIn)) return { deducted: 0, count: 0, close: true };
    if (!session.realtimeDeductionsEnabled || session.checkoutPending || session.dayPass?.isPurchased) return { deducted: 0, count: 0 };
    const quote = visitChargeQuote({ ...session, checkInAt: checkIn, hourlyRate: session.hourlyRateSnapshot ?? hourlyRate(fee, checkIn) }, now);
    const count = quote.deductionCount - (session.deductionCount || 0), due = money(quote.due);
    if (count <= 0 || due <= 0) return { deducted: 0, count: 0 };
    const before = amount(member.membership?.points ?? 0);
    if (before < due) return { deducted: 0, count: 0, insufficient: {
      currentPoints: before, pointsDue: due, shortfall: money(due - before), hoursDue: quote.hoursAdjustment, deductionCountTarget: quote.deductionCount,
    } };
    const stamp = Timestamp.now(), balance = money(before - due);
    tx.update(db.collection(C.USERS).doc(session.userId), { 'membership.points': balance,
      'membership.totalVisitHours': amount(member.membership?.totalVisitHours ?? 0) + quote.hoursAdjustment, updatedAt: stamp });
    tx.update(ref, { realtimePointsDeducted: quote.total, deductionCount: quote.deductionCount,
      nextDeductionAt: Timestamp.fromMillis(checkIn.getTime() + 3600000 + (quote.deductionCount - 1) * 1800000), updatedAt: stamp });
    tx.create(db.collection(C.POINTS_RECORDS).doc(`visit-${sessionId}-interval-${quote.deductionCount}`), {
      userId: session.userId, storeId: session.storeId, source: 'visit', relatedId: sessionId, type: 'spend', amount: due,
      balanceBefore: before, balance, description: 'Visit interval charge', createdBy: uid, effectiveAt: stamp, createdAt: stamp,
    });
    return { deducted: due, count };
  });
  if ('close' in result) await settleLoungeVisit(db, sessionId, now, { automatic: true });
  return result;
}
