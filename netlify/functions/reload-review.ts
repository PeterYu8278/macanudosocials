import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from './_shared/firestoreMonitoring';
import { toWebFunction, type EventHandler } from './_shared/webFunction';
import { requireReloadOperator, reviewManualReload } from './_shared/manualReload';
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections';

const reply = (statusCode: number, data: Record<string, unknown>) => ({ statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) });
export const eventHandler: EventHandler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, { success: false });
  try {
    if (!getApps().length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) return reply(503, { success: false, code: 'SERVICE_UNAVAILABLE' });
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    }
    const token = event.headers.authorization?.startsWith('Bearer ') ? event.headers.authorization.slice(7) : '';
    let identity;
    try { identity = token && await getAuth().verifyIdToken(token); }
    catch { return reply(401, { success: false, code: 'UNAUTHENTICATED' }); }
    if (!identity) return reply(401, { success: false, code: 'UNAUTHENTICATED' });
    const db = getFirestore();
    let actor = await db.collection(C.USERS).doc(identity.uid).get();
    if (!actor.exists && identity.email) {
      const matches = await db.collection(C.USERS).where('email', '==', identity.email.toLowerCase()).limit(1).get();
      actor = matches.docs[0] || actor;
    }
    if (!actor.exists) return reply(403, { success: false, code: 'FORBIDDEN' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { success: false, code: 'INVALID_REQUEST' }); }
    if (body.action === 'create') {
      if (typeof body.userId !== 'string' || !body.userId || body.userId.includes('/')
        || typeof body.storeId !== 'string' || !body.storeId || body.storeId.includes('/')
        || typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0
        || Math.round(body.amount * 100) / 100 !== body.amount) return reply(400, { success: false, code: 'INVALID_REQUEST' });
      const newRecord = db.collection(C.RELOAD_RECORDS).doc();
      await db.runTransaction(async tx => {
        const freshActor = await tx.get(actor.ref);
        const target = await tx.get(db.collection(C.USERS).doc(body.userId));
        const store = await tx.get(db.collection(C.STORES).doc(body.storeId));
        const config = await tx.get(db.collection(C.APP_CONFIG).doc('default'));
        const lock = await tx.get(db.collection(C.MEMBERSHIP_PAYMENT_LOCKS).doc(body.userId));
        const pending = await tx.get(db.collection(C.RELOAD_RECORDS).where('userId', '==', body.userId).where('status', '==', 'pending').limit(1));
        if (!target.exists || !store.exists || !freshActor.exists) throw new Error('INVALID_REQUEST');
        if (body.operatorManual === true) requireReloadOperator(freshActor.data(), body.storeId);
        else if (body.userId !== actor.id || ![100, 200, 500].includes(body.amount)
          || config.data()?.payment?.billplz?.enabled === true) throw new Error('FORBIDDEN');
        if (!pending.empty) throw new Error('MEMBERSHIP_PAYMENT_PENDING');
        if (lock.exists) {
          const order = await tx.get(db.collection(C.MEMBERSHIP_PAYMENTS).doc(lock.data()!.orderId));
          if (['creating', 'pending'].includes(order.data()?.status)) throw new Error('MEMBERSHIP_PAYMENT_PENDING');
        }
        const fees = await tx.get(db.collection(C.MEMBERSHIP_FEE_RECORDS)
          .where('userId', '==', body.userId).where('status', '==', 'paid'));
        if (!fees.docs.some(doc => Number(doc.data().amount) > 0)) throw new Error('INITIAL_MEMBERSHIP_REQUIRED');
        const timestamp = Timestamp.now();
        // Serializes simultaneous requests for the same user even if the query was initially empty.
        tx.update(target.ref, { updatedAt: timestamp });
        tx.set(newRecord, { userId: body.userId, userName: target.data()?.displayName || '', requestedAmount: body.amount,
          pointsEquivalent: Math.round(body.amount), pointsEquivalentBasis: 'net', annualFeeAmount: 0,
          storeId: body.storeId, paymentMethod: 'manual', status: 'pending',
          createdAt: timestamp, updatedAt: timestamp });
      });
      return reply(200, { success: true, recordId: newRecord.id });
    }
    if (!['approve', 'reject', 'cancel'].includes(body.action)
      || typeof body.recordId !== 'string' || !body.recordId || body.recordId.includes('/')
      || (body.proof !== undefined && (typeof body.proof !== 'string' || body.proof.length > 4096))
      || (body.notes !== undefined && (typeof body.notes !== 'string' || body.notes.length > 4000))) {
      return reply(400, { success: false, code: 'INVALID_REQUEST' });
    }
    if (body.creditOnly !== undefined && typeof body.creditOnly !== 'boolean') return reply(400, { success: false, code: 'INVALID_REQUEST' });
    const result = await reviewManualReload(db, { action: body.action, recordId: body.recordId,
      actorId: actor.id, actualAmount: body.actualAmount, proof: body.proof, notes: body.notes, creditOnly: body.creditOnly });
    return reply(200, { success: true, ...result });
  } catch (error: any) {
    const code = error?.message;
    const known = ['FORBIDDEN', 'RECORD_NOT_FOUND', 'RECORD_ALREADY_PROCESSED', 'INVALID_MANUAL_ORDER',
      'PAYMENT_PROOF_REQUIRED', 'PAYMENT_AMOUNT_MISMATCH', 'MEMBERSHIP_REVIEW_REQUIRED', 'INITIAL_MEMBERSHIP_REQUIRED',
      'ONLINE_PAYMENT_REQUIRES_CALLBACK', 'MEMBERSHIP_PAYMENT_PENDING', 'INVALID_AMOUNT', 'USER_NOT_FOUND', 'INVALID_REQUEST'];
    return reply(code === 'FORBIDDEN' ? 403 : known.includes(code) ? 409 : 503,
      { success: false, code: known.includes(code) ? code : 'SERVICE_UNAVAILABLE' });
  }
};
export default toWebFunction(eventHandler);
