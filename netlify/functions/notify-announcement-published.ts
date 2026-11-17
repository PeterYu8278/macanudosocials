import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from './_shared/firestoreMonitoring';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import {
  completeNotificationDelivery,
  createNotificationDelivery,
  trackedClickAction,
  updateDeliveryRecipient,
} from './_shared/notificationHistory';

const SITE_URL = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://macanudosocials.com';
const ALLOWED_ROLES = new Set(['admin', 'storeAdmin', 'superAdmin', 'developer']);
const INVALID_FCM_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

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

const verifyAdmin = async (authorization?: string) => {
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  if (!token) throw new Error('UNAUTHENTICATED');

  initializeAdmin();
  const decoded = await getAuth().verifyIdToken(token);
  const db = getFirestore();
  let userSnapshot = await db.collection('users').doc(decoded.uid).get();
  if (!userSnapshot.exists && decoded.email) {
    const matches = await db.collection('users')
      .where('email', '==', decoded.email.toLowerCase())
      .limit(1)
      .get();
    userSnapshot = matches.docs[0] || userSnapshot;
  }

  const role = (decoded.role as string | undefined) || userSnapshot.data()?.role;
  if (!role || !ALLOWED_ROLES.has(role)) throw new Error('FORBIDDEN');
};

const asDate = (value: unknown) => {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
};

const claimDispatch = async (announcementId: string) => {
  const db = getFirestore();
  const ref = db.collection('scheduledNotificationDispatches')
    .doc(`announcement-published-${announcementId}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (data?.status === 'completed') return { ref, claimed: false, alreadySent: true };

    const updatedAt = asDate(data?.updatedAt);
    if (data?.status === 'processing' && updatedAt && Date.now() - updatedAt.getTime() < 10 * 60 * 1000) {
      return { ref, claimed: false, alreadySent: false };
    }

    transaction.set(ref, {
      type: 'announcement_published',
      announcementId,
      status: 'processing',
      attempts: Number(data?.attempts || 0) + 1,
      createdAt: data?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ref, claimed: true, alreadySent: false };
  });
};

export const eventHandler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST') return reply(405, { success: false, error: 'Method not allowed' });

  try {
    await verifyAdmin(event.headers.authorization);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNAUTHENTICATED';
    return reply(message === 'FORBIDDEN' ? 403 : 401, {
      success: false,
      error: message === 'FORBIDDEN' ? 'Administrator permission required' : 'Authentication required',
    });
  }

  let dispatchRef: FirebaseFirestore.DocumentReference | null = null;
  try {
    const request = JSON.parse(event.body || '{}') as { announcementId?: unknown };
    const announcementId = typeof request.announcementId === 'string'
      ? request.announcementId.trim()
      : '';
    if (!announcementId) return reply(400, { success: false, error: 'announcementId is required' });

    const db = getFirestore();
    const announcementSnapshot = await db.collection('announcements').doc(announcementId).get();
    if (!announcementSnapshot.exists) {
      return reply(404, { success: false, error: 'Announcement not found' });
    }

    const announcement = announcementSnapshot.data()!;
    if (announcement.status !== 'published') {
      return reply(409, { success: false, error: 'Only published announcements can trigger notifications' });
    }

    const dispatch = await claimDispatch(announcementId);
    dispatchRef = dispatch.ref;
    if (!dispatch.claimed) {
      return reply(200, { success: true, alreadySent: dispatch.alreadySent });
    }

    const usersSnapshot = await db.collection('users').get();
    const users = usersSnapshot.docs.filter((user) => {
      const preferences = user.data().preferences;
      return preferences?.notifications !== false
        && preferences?.pushNotifications?.types?.activity !== false;
    });

    const fcmTargets: Array<{
      token: string;
      ref: FirebaseFirestore.DocumentReference;
      userId: string;
      deviceId?: string;
    }> = [];
    const oneSignalIds = new Set<string>();
    const targetedUserIds = new Set<string>();
    const recipientIdentifiers = new Map<string, { deviceIds: string[]; subscriptionIds: string[] }>();
    await Promise.all(users.map(async (user) => {
      const tokens = await user.ref.collection('fcmTokens').where('active', '==', true).get();
      const identifiers = { deviceIds: [] as string[], subscriptionIds: [] as string[] };
      tokens.forEach((tokenDocument) => {
        const tokenData = tokenDocument.data();
        const token = tokenData.token;
        if (typeof token === 'string' && token.trim()) {
          const deviceId = typeof tokenData.deviceId === 'string' && tokenData.deviceId.trim()
            ? tokenData.deviceId.trim()
            : undefined;
          fcmTargets.push({ token: token.trim(), ref: tokenDocument.ref, userId: user.id, deviceId });
          targetedUserIds.add(user.id);
          if (deviceId) identifiers.deviceIds.push(deviceId);
        }
      });

      const subscriptions = await user.ref.collection('notificationSubscriptions').get();
      subscriptions.forEach((subscription) => {
        const data = subscription.data();
        if (
          data.provider === 'onesignal'
          && data.status === 'subscribed'
          && data.optedIn === true
          && typeof data.subscriptionId === 'string'
          && data.subscriptionId.trim()
        ) {
          const subscriptionId = data.subscriptionId.trim();
          oneSignalIds.add(subscriptionId);
          targetedUserIds.add(user.id);
          identifiers.subscriptionIds.push(subscriptionId);
        }
      });
      if (identifiers.deviceIds.length || identifiers.subscriptionIds.length) {
        recipientIdentifiers.set(user.id, identifiers);
      }
    }));

    const announcementTitle = String(announcement.title || 'New Announcement').trim();
    const announcementContent = String(announcement.content || 'A new announcement is available.')
      .trim()
      .slice(0, 500);
    const title = `New Announcement: ${announcementTitle}`.slice(0, 100);
    const clickAction = '/events';
    const deliveryRef = await createNotificationDelivery(db, {
      title,
      body: announcementContent,
      type: 'announcement',
      source: 'announcement_published',
      provider: fcmTargets.length > 0 && oneSignalIds.size > 0
        ? 'mixed'
        : fcmTargets.length > 0 ? 'fcm' : 'onesignal',
      clickAction,
      relatedId: announcementId,
      recipients: users.filter((user) => targetedUserIds.has(user.id)).map((user) => ({
        userId: user.id,
        displayName: user.data().displayName,
        email: user.data().email,
        deviceIds: recipientIdentifiers.get(user.id)?.deviceIds,
        subscriptionIds: recipientIdentifiers.get(user.id)?.subscriptionIds,
      })),
    });
    const trackedAction = trackedClickAction(clickAction, deliveryRef.id);
    const notificationUrl = new URL(trackedAction, SITE_URL).toString();
    const icon = new URL('/icons/app-logo-192.png', SITE_URL).toString();
    const badge = new URL('/icons/notification-badge-96.png', SITE_URL).toString();
    const result = { fcmSent: 0, fcmFailed: 0, oneSignalAccepted: 0 };

    for (let offset = 0; offset < fcmTargets.length; offset += 500) {
      const batchTargets = fcmTargets.slice(offset, offset + 500);
      const sendResult = await getMessaging().sendEachForMulticast({
        notification: { title, body: announcementContent },
        data: { type: 'announcement', announcementId, clickAction: trackedAction, deliveryId: deliveryRef.id },
        tokens: batchTargets.map((target) => target.token),
        webpush: {
          headers: { Urgency: 'high', TTL: '86400' },
          fcmOptions: { link: notificationUrl },
          notification: { icon, badge },
        },
      });
      result.fcmSent += sendResult.successCount;
      result.fcmFailed += sendResult.failureCount;

      await Promise.all(sendResult.responses.map(async (response, index) => {
        const code = response.error?.code;
        if (!response.success && code && INVALID_FCM_CODES.has(code)) {
          await batchTargets[index].ref.set({
            active: false,
            lastError: code,
            lastErrorAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      }));
    }

    if (oneSignalIds.size > 0) {
      const appId = process.env.ONESIGNAL_APP_ID;
      const apiKey = process.env.ONESIGNAL_REST_API_KEY;
      if (!appId || !apiKey) throw new Error('OneSignal is not configured');

      const oneSignalResponse = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: appId,
          target_channel: 'push',
          include_subscription_ids: [...oneSignalIds],
          headings: { en: title },
          contents: { en: announcementContent },
          url: notificationUrl,
          chrome_web_icon: icon,
          chrome_web_badge: badge,
          priority: 10,
          data: { type: 'announcement', announcementId, clickAction: trackedAction, deliveryId: deliveryRef.id },
        }),
      });
      const responseText = await oneSignalResponse.text();
      if (!oneSignalResponse.ok) {
        throw new Error(`OneSignal ${oneSignalResponse.status}: ${responseText.slice(0, 300)}`);
      }
      result.oneSignalAccepted = oneSignalIds.size;
    }

    for (const userId of targetedUserIds) {
      await updateDeliveryRecipient(deliveryRef, userId, { status: 'sent', sent: 1, failed: 0 });
    }
    await completeNotificationDelivery(deliveryRef, {
      sent: result.fcmSent + result.oneSignalAccepted,
      failed: result.fcmFailed,
    });

    await dispatchRef.set({ status: 'completed', result, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return reply(200, { success: true, result });
  } catch (error) {
    if (dispatchRef) {
      await dispatchRef.set({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    console.error('[notify-announcement-published]', error);
    return reply(500, {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send announcement notification',
    });
  }
};

export default toWebFunction(eventHandler)
