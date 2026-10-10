/**
 * Netlify Function: Billplz Callback Handler
 * Handles successful payment callbacks from Billplz
 */
import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from './_shared/firestoreMonitoring';
import { createHmac, timingSafeEqual } from 'crypto';
import { GLOBAL_COLLECTIONS } from '../../src/config/globalCollections';
import { settlePendingVisitCheckout } from './_shared/pendingVisitCheckout';
import { handleMembershipBill } from './_shared/membershipPayment';

// Initialize Firebase Admin
if (!getApps().length) {
  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccount) {
      initializeApp({
        credential: cert(JSON.parse(serviceAccount))
      });
    } else {
      console.error('[billplz-callback] FIREBASE_SERVICE_ACCOUNT not configured');
    }
  } catch (error) {
    console.error('[billplz-callback] Failed to initialize Firebase Admin:', error);
  }
}

const db = getFirestore();

/**
 * Verify Billplz X-Signature
 * Spec: HMAC-SHA256 of case-insensitively sorted key+value pairs (excluding x_signature itself)
 * joined by "|", using the X-Signature Key as secret.
 */
export function verifyXSignature(params: URLSearchParams, xSignatureKey: string): boolean {
  const receivedSig = params.get('x_signature');
  if (!receivedSig || !/^[a-f0-9]{64}$/i.test(receivedSig)) return false;

  // Collect all params except x_signature, sort alphabetically by key
  const entries: string[] = [];
  params.forEach((value, key) => {
    if (key !== 'x_signature') entries.push(`${key}${value}`);
  });
  entries.sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0);

  const source = entries.join('|');
  const computed = createHmac('sha256', xSignatureKey).update(source).digest('hex');
  return timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(receivedSig, 'hex'));
}

export const eventHandler: Handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Billplz sends callbacks as x-www-form-urlencoded
    const params = new URLSearchParams(event.body || '');
    const billId = params.get('id');
    const paid = params.get('paid');
    const status = params.get('state');

    // --- X-Signature verification ---
    // Read both possible xSignatureKeys from appConfig
    const appConfigDoc = await db.collection(GLOBAL_COLLECTIONS.APP_CONFIG).doc('default').get();
    const appConfigData = appConfigDoc.data() || {};
    const clientXSigKey = appConfigData?.payment?.billplz?.xSignatureKey as string | undefined;
    const platformXSigKey = appConfigData?.paymentPlatform?.billplz?.xSignatureKey as string | undefined;

    const clientValid = clientXSigKey ? verifyXSignature(params, clientXSigKey) : false;
    const platformValid = platformXSigKey ? verifyXSignature(params, platformXSigKey) : false;

    if (!clientValid && !platformValid) {
      console.error(`[billplz-callback] X-Signature verification failed for Bill ID: ${billId}`);
      return { statusCode: 401, body: 'Unauthorized: Invalid X-Signature' };
    }
    // --------------------------------

    console.log(`[billplz-callback] Received callback for Bill ID: ${billId}, Paid: ${paid}, Status: ${status}`);

    if (paid === 'true') {
      if (await handleMembershipBill(db, billId || '', Number(params.get('paid_amount')), clientValid, event.queryStringParameters?.membershipOrder, event.queryStringParameters?.membershipProof)) {
        return { statusCode: 200, body: 'OK (Annual Pass processed)' };
      }
      // 1. Try to find a Reload Record
      const reloadSnapshot = await db.collection(GLOBAL_COLLECTIONS.RELOAD_RECORDS)
        .where('billplzId', '==', billId)
        .limit(1)
        .get();

      if (!reloadSnapshot.empty) {
        const recordDoc = reloadSnapshot.docs[0];
        const recordData = recordDoc.data();

        if (recordData.status === 'completed') {
          return { statusCode: 200, body: 'OK (Already processed)' };
        }

        const userId = recordData.userId;
        const amount = recordData.requestedAmount;
        const points = recordData.pointsEquivalent;

        await db.runTransaction(async (transaction) => {
          const userRef = db.collection(GLOBAL_COLLECTIONS.USERS).doc(userId);
          const userDoc = await transaction.get(userRef);
          if (!userDoc.exists) throw new Error('User not found');

          // Update Points
          transaction.update(userRef, {
            'membership.points': FieldValue.increment(points),
            ...(userDoc.data()?.role === 'guest' && { role: 'member' }),
            updatedAt: FieldValue.serverTimestamp()
          });

          // Update Reload Record
          transaction.update(recordDoc.ref, {
            status: 'completed',
            verifiedAt: FieldValue.serverTimestamp(),
            verifiedBy: 'system_billplz',
            adminNotes: `Auto-verified via Billplz (ID: ${billId}, Paid: ${params.get('paid_at')})`,
            updatedAt: FieldValue.serverTimestamp()
          });

          // Create Points Record
          const pointsRecordRef = db.collection(GLOBAL_COLLECTIONS.POINTS_RECORDS).doc();
          transaction.set(pointsRecordRef, {
            userId,
            userName: recordData.userName || 'Member',
            type: 'earn',
            amount: points,
            source: 'reload',
            description: `Billplz Online Reload: ${amount} RM (Bill ID: ${billId})`,
            relatedId: recordDoc.id,
            balance: (userDoc.data()?.membership?.points || 0) + points,
            createdBy: 'system_billplz',
            createdAt: FieldValue.serverTimestamp()
          });
        });

        try {
          const checkoutResult = await settlePendingVisitCheckout(db, userId);
          console.log(`[billplz-callback] Pending checkout result for ${userId}: ${checkoutResult.status}`);
        } catch (checkoutError) {
          // The scheduled function retries durable pending checkouts every minute.
          console.error(`[billplz-callback] Automatic checkout failed for ${userId}:`, checkoutError);
        }

        console.log(`[billplz-callback] Successfully processed reload for user ${userId}`);
        return { statusCode: 200, body: 'OK' };
      }

      // 2. Try to find a Shop Order
      const orderSnapshot = await db.collection(GLOBAL_COLLECTIONS.ORDERS)
        .where('payment.billplzId', '==', billId)
        .limit(1)
        .get();

      if (!orderSnapshot.empty) {
        const orderDoc = orderSnapshot.docs[0];
        const orderData = orderDoc.data();

        if (orderData.status === 'confirmed' || orderData.status === 'completed') {
          return { statusCode: 200, body: 'OK (Already processed)' };
        }

        await db.runTransaction(async (transaction) => {
          // Update Order Status
          transaction.update(orderDoc.ref, {
            status: 'confirmed',
            'payment.paidAt': FieldValue.serverTimestamp(),
            'payment.transactionId': billId,
            updatedAt: FieldValue.serverTimestamp()
          });
        });

        console.log(`[billplz-callback] Successfully processed order ${orderDoc.id}`);
        return { statusCode: 200, body: 'OK' };
      }

      // 3. Try to find a Subscription Request
      const subSnapshot = await db.collection(GLOBAL_COLLECTIONS.SUBSCRIPTION_REQUESTS)
        .where('billplzId', '==', billId)
        .limit(1)
        .get();

      if (!subSnapshot.empty) {
        const subDoc = subSnapshot.docs[0];
        const subData = subDoc.data();

        if (subData.status === 'approved') {
          return { statusCode: 200, body: 'OK (Already processed)' };
        }

        await db.runTransaction(async (transaction) => {
          // Get AppConfig to find plan details
          const appConfigRef = db.collection(GLOBAL_COLLECTIONS.APP_CONFIG).doc('default');
          const appConfigDoc = await transaction.get(appConfigRef);
          const appConfigData = appConfigDoc.data();

          const plan = appConfigData?.subscription?.plans?.find((p: any) => p.id === subData.planId);
          const validMonths = plan?.validPeriodMonth || 12;

          // Calculate new expiry date
          const now = new Date();
          const newExpiry = new Date(now.getFullYear(), now.getMonth() + validMonths, now.getDate());

          // Update Subscription Request
          transaction.update(subDoc.ref, {
            status: 'approved',
            verifiedBy: 'system_billplz',
            developerNotes: `Auto-approved via Platform Billplz (ID: ${billId})`,
            expiryDate: newExpiry,
            updatedAt: FieldValue.serverTimestamp()
          });

          // Update AppConfig
          transaction.update(appConfigRef, {
            'subscription.isActive': true,
            'subscription.planId': subData.planId,
            'subscription.plan': subData.planId,
            'subscription.expiryDate': newExpiry,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: 'system_billplz'
          });

          // Sync user-level subscription record if userId present
          const userId = subData.userId as string | undefined;
          if (userId) {
            const userRef = db.collection(GLOBAL_COLLECTIONS.USERS).doc(userId);
            transaction.update(userRef, {
              'membership.subscriptionPlanId': subData.planId,
              'membership.subscriptionExpiresAt': newExpiry,
              'membership.subscriptionStatus': 'active',
              updatedAt: FieldValue.serverTimestamp()
            });
          }
        });

        console.log(`[billplz-callback] Successfully processed subscription request ${subDoc.id}`);
        return { statusCode: 200, body: 'OK' };
      }

      console.error(`[billplz-callback] No matching record found for Bill ID: ${billId}`);
      return { statusCode: 404, body: 'Record Not Found' };
    }

    return { statusCode: 200, body: 'OK (Payment not successful)' };

  } catch (error: any) {
    console.error('[billplz-callback] Error processing callback:', error);
    return { statusCode: 500, body: `Internal Server Error: ${error.message}` };
  }
};

export default toWebFunction(eventHandler)
