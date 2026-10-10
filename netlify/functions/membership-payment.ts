import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import axios from 'axios';
import { randomBytes } from 'node:crypto';
import { getFirestore, Timestamp } from './_shared/firestoreMonitoring';
import { toWebFunction, type EventHandler } from './_shared/webFunction';
import { annualFee, fulfillMembershipPayment, hasAnnualHistory } from './_shared/membershipPayment';
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections';

const reply = (statusCode: number, data: Record<string, unknown>) => ({
  statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data),
});

export const eventHandler: EventHandler = async event => {
  if (!['GET', 'POST'].includes(event.httpMethod)) return reply(405, { success: false });
  try {
    if (!getApps().length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('SERVICE_UNAVAILABLE');
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    }
    const token = event.headers.authorization?.startsWith('Bearer ') ? event.headers.authorization.slice(7) : '';
    if (!token) return reply(401, { success: false, code: 'UNAUTHENTICATED' });
    let identity;
    try { identity = await getAuth().verifyIdToken(token); }
    catch { return reply(401, { success: false, code: 'UNAUTHENTICATED' }); }
    const db = getFirestore();
    let userSnapshot = await db.collection(C.USERS).doc(identity.uid).get();
    if (!userSnapshot.exists && identity.email) {
      const matches = await db.collection(C.USERS).where('email', '==', identity.email.toLowerCase()).limit(1).get();
      userSnapshot = matches.docs[0] || userSnapshot;
    }
    if (!userSnapshot.exists) throw new Error('USER_NOT_FOUND');
    const user = userSnapshot.data()!;
    const appConfig = (await db.collection(C.APP_CONFIG).doc('default').get()).data();
    const gateway = appConfig?.payment?.billplz;
    const baseUrl = gateway?.isSandbox !== false ? 'https://www.billplz-sandbox.com/api/v3' : 'https://www.billplz.com/api/v3';
    const gatewayOptions = { headers: { Authorization: `Basic ${Buffer.from(`${gateway?.apiKey}:`).toString('base64')}` }, timeout: 15000 };

    const orderId = event.queryStringParameters?.order;
    if (event.httpMethod === 'GET' && orderId) {
      const orderRef = db.collection(C.MEMBERSHIP_PAYMENTS).doc(orderId);
      const snapshot = await orderRef.get();
      if (!snapshot.exists || snapshot.data()?.userId !== userSnapshot.id) throw new Error('PAYMENT_NOT_FOUND');
      let order = snapshot.data()!;
      // Recover a delayed/missed callback using the gateway's authenticated bill status.
      if (order.status === 'pending' && gateway?.apiKey) {
        const bill = (await axios.get(`${baseUrl}/bills/${encodeURIComponent(order.billplzId)}`, gatewayOptions)).data;
        if (bill.paid === true && bill.id === order.billplzId && Number(bill.amount) === order.totalCents) {
          await fulfillMembershipPayment(db, orderId, bill.id, Number(bill.paid_amount));
          order = (await orderRef.get()).data()!;
        }
      }
      return reply(200, { success: true, status: order.status, balance: order.balance ?? null });
    }

    const renewal = await hasAnnualHistory(db, userSnapshot.id, user);
    const fee = annualFee((await db.collection(C.CONFIG).doc('membershipFee').get()).data());
    if (event.httpMethod === 'GET') {
      const lock = await db.collection(C.MEMBERSHIP_PAYMENT_LOCKS).doc(userSnapshot.id).get();
      if (lock.exists) {
        const existing = await db.collection(C.MEMBERSHIP_PAYMENTS).doc(lock.data()!.orderId).get();
        const pending = existing.data();
        if (pending?.status === 'pending') return reply(200, {
          success: true, annualFee: pending.annualFee, renewal: pending.renewalType === 'renewal',
          pending: true, reloadAmount: pending.reloadAmount, storeId: pending.storeId,
        });
        if (pending?.status === 'creating') throw new Error('PAYMENT_CREATING');
      }
      return reply(200, { success: true, annualFee: fee, renewal });
    }
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { throw new Error('INVALID_REQUEST'); }
    const reloadAmount = body.reloadAmount;
    if (![100, 200, 500].includes(reloadAmount) && !(renewal && reloadAmount === 0)) throw new Error('INVALID_RELOAD_AMOUNT');
    if (typeof body.storeId !== 'string' || !body.storeId.trim() || body.storeId.includes('/')) throw new Error('STORE_REQUIRED');
    if (!(await db.collection(C.STORES).doc(body.storeId.trim()).get()).exists) throw new Error('STORE_REQUIRED');
    if (!gateway?.enabled || !gateway.apiKey || !gateway.collectionId || !gateway.xSignatureKey) throw new Error('PAYMENT_UNAVAILABLE');
    const totalCents = Math.round(fee * 100) + reloadAmount * 100;
    const lockRef = db.collection(C.MEMBERSHIP_PAYMENT_LOCKS).doc(userSnapshot.id);
    const newOrderRef = db.collection(C.MEMBERSHIP_PAYMENTS).doc();
    const callbackProof = randomBytes(32).toString('hex');
    const reservation = await db.runTransaction(async tx => {
      const [freshUser, lock] = await Promise.all([tx.get(userSnapshot.ref), tx.get(lockRef)]);
      if (!freshUser.exists) throw new Error('USER_NOT_FOUND');
      if (freshUser.data()?.status === 'active') throw new Error('ALREADY_ACTIVE');
      if (freshUser.data()?.status === 'suspended') throw new Error('ACCOUNT_SUSPENDED');
      if (lock.exists) {
        const existing = await tx.get(db.collection(C.MEMBERSHIP_PAYMENTS).doc(lock.data()!.orderId));
        if (existing.exists && ['creating', 'pending'].includes(existing.data()!.status)) {
          return { id: existing.id, existing: existing.data()! };
        }
      }
      const now = Timestamp.now();
      tx.set(newOrderRef, {
        userId: userSnapshot.id, annualFee: fee, reloadAmount, totalCents,
        renewalType: renewal ? 'renewal' : 'initial', storeId: body.storeId.trim(),
        status: 'creating', callbackProof, createdAt: now, updatedAt: now,
      });
      tx.set(lockRef, { orderId: newOrderRef.id, createdAt: now });
      return { id: newOrderRef.id, existing: null };
    });
    if (reservation.existing) {
      if (!reservation.existing.paymentUrl) throw new Error('PAYMENT_CREATING');
      return reply(200, { success: true, orderId: reservation.id, paymentUrl: reservation.existing.paymentUrl, resumed: true });
    }
    const requestOrigin = new URL(event.rawUrl).origin;
    const origin = process.env.URL || (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin) ? requestOrigin : 'https://macanudosocials.com');
    // Keep ambiguous creation failures locked: retrying could otherwise create a second payable bill.
    const bill = (await axios.post(`${baseUrl}/bills`, {
      collection_id: gateway.collectionId, name: user.displayName || 'Member', email: user.email || '',
      mobile: user.phone || '', amount: totalCents,
      description: `Annual Pass: RM ${fee} + Reload RM ${reloadAmount} (${reservation.id})`,
      reference_1_label: 'Membership payment', reference_1: reservation.id,
      callback_url: `${origin}/.netlify/functions/billplz-callback?membershipOrder=${encodeURIComponent(reservation.id)}&membershipProof=${callbackProof}`,
      redirect_url: `${origin}/payment/result?membershipOrder=${encodeURIComponent(reservation.id)}`,
    }, gatewayOptions)).data;
    if (!bill.id || !bill.url || Number(bill.amount) !== totalCents) throw new Error('PAYMENT_UNAVAILABLE');
    await db.runTransaction(async tx => {
      const current = await tx.get(newOrderRef);
      // A very fast callback may already have fulfilled this order before bill creation returns.
      tx.update(newOrderRef, {
        billplzId: bill.id, paymentUrl: bill.url,
        ...(current.data()?.status === 'creating' && { status: 'pending' }), updatedAt: Timestamp.now(),
      });
    });
    return reply(200, { success: true, orderId: newOrderRef.id, paymentUrl: bill.url });
  } catch (error: any) {
    const code = error?.message || 'PAYMENT_UNAVAILABLE';
    const known = ['USER_NOT_FOUND', 'PAYMENT_NOT_FOUND', 'INVALID_REQUEST', 'INVALID_RELOAD_AMOUNT', 'STORE_REQUIRED', 'ALREADY_ACTIVE', 'ACCOUNT_SUSPENDED', 'PAYMENT_CREATING'];
    if (!known.includes(code)) console.error('[membership-payment] Failed', { code: error?.code || 'dependency_error' });
    return reply(known.includes(code) ? 409 : 503, { success: false, code: known.includes(code) ? code : 'PAYMENT_UNAVAILABLE' });
  }
};

export default toWebFunction(eventHandler);
