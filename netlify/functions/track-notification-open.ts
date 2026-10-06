import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

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
  if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
  initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
};

export const eventHandler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST') return reply(405, { success: false });

  try {
    initializeAdmin();
    const body = JSON.parse(event.body || '{}') as Record<string, unknown>;
    const deliveryId = typeof body.deliveryId === 'string' ? body.deliveryId.trim() : '';
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    const subscriptionId = typeof body.subscriptionId === 'string' ? body.subscriptionId.trim() : '';
    if (!deliveryId) return reply(400, { success: false, error: 'deliveryId is required' });

    const db = getFirestore();
    const deliveryRef = db.collection('notificationDeliveries').doc(deliveryId);
    if (!(await deliveryRef.get()).exists) return reply(404, { success: false, error: 'Delivery not found' });

    let userId = '';
    const authorization = event.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      try {
        userId = (await getAuth().verifyIdToken(authorization.slice(7))).uid;
      } catch {
        userId = '';
      }
    }

    let recipient: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot | null = null;
    if (userId) {
      const direct = await deliveryRef.collection('recipients').doc(userId).get();
      if (direct.exists) recipient = direct;
    }
    if (!recipient && subscriptionId) {
      const match = await deliveryRef.collection('recipients')
        .where('subscriptionIds', 'array-contains', subscriptionId).limit(1).get();
      recipient = match.docs[0] || null;
    }
    if (!recipient && deviceId) {
      const match = await deliveryRef.collection('recipients')
        .where('deviceIds', 'array-contains', deviceId).limit(1).get();
      recipient = match.docs[0] || null;
    }

    if (!recipient) {
      return reply(200, { success: true, identified: false });
    }

    await db.runTransaction(async (transaction) => {
      const freshRecipient = await transaction.get(recipient!.ref);
      if (freshRecipient.data()?.opened === true) return;
      transaction.set(recipient!.ref, {
        opened: true,
        openedAt: FieldValue.serverTimestamp(),
        status: 'opened',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.set(deliveryRef, {
        'counts.opened': FieldValue.increment(1),
        lastOpenedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    return reply(200, { success: true, identified: true });
  } catch (error) {
    console.error('[track-notification-open]', error);
    return reply(500, { success: false, error: 'Unable to record notification open' });
  }
};

export default toWebFunction(eventHandler)
