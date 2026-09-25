import type { Handler } from '@netlify/functions';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';

const TIME_ZONE = 'Asia/Singapore';
const SITE_URL = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://macanudosocials.com';
const ALLOWED_ROLES = new Set(['admin', 'superAdmin', 'developer']);
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

const formatEventDate = (date: Date) => new Intl.DateTimeFormat('en-MY', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}).format(date);

const claimDispatch = async (eventId: string) => {
  const db = getFirestore();
  const ref = db.collection('scheduledNotificationDispatches').doc(`event-published-${eventId}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (data?.status === 'completed') return { ref, claimed: false, alreadySent: true };

    const updatedAt = asDate(data?.updatedAt);
    if (data?.status === 'processing' && updatedAt && Date.now() - updatedAt.getTime() < 10 * 60 * 1000) {
      return { ref, claimed: false, alreadySent: false };
    }

    transaction.set(ref, {
      type: 'event_published',
      eventId,
      status: 'processing',
      attempts: Number(data?.attempts || 0) + 1,
      createdAt: data?.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ref, claimed: true, alreadySent: false };
  });
};

export const handler: Handler = async (event) => {
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
    const request = JSON.parse(event.body || '{}') as { eventId?: unknown };
    const eventId = typeof request.eventId === 'string' ? request.eventId.trim() : '';
    if (!eventId) return reply(400, { success: false, error: 'eventId is required' });

    const db = getFirestore();
    const eventSnapshot = await db.collection('events').doc(eventId).get();
    if (!eventSnapshot.exists) return reply(404, { success: false, error: 'Event not found' });

    const eventData = eventSnapshot.data()!;
    if (eventData.status !== 'published') {
      return reply(409, { success: false, error: 'Only published events can trigger this notification' });
    }

    const dispatch = await claimDispatch(eventId);
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

    const fcmTargets: Array<{ token: string; ref: FirebaseFirestore.DocumentReference }> = [];
    const oneSignalIds = new Set<string>();
    await Promise.all(users.map(async (user) => {
      const tokens = await user.ref.collection('fcmTokens').where('active', '==', true).get();
      tokens.forEach((tokenDocument) => {
        const token = tokenDocument.data().token;
        if (typeof token === 'string' && token.trim()) {
          fcmTargets.push({ token: token.trim(), ref: tokenDocument.ref });
        }
      });

      if (!tokens.empty) return;
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
          oneSignalIds.add(data.subscriptionId.trim());
        }
      });
    }));

    const title = `New Event: ${String(eventData.title || 'Cigar Gathering')}`;
    const startDate = asDate(eventData.schedule?.startDate);
    const dateText = startDate ? formatEventDate(startDate) : 'soon';
    const location = eventData.location?.name || eventData.location?.address || 'Macanudo Socials';
    const body = `${eventData.title || 'Cigar Gathering'} is open for registration on ${dateText} at ${location}. Limited seats - register now!`;
    const clickAction = '/events';
    const notificationUrl = new URL(clickAction, SITE_URL).toString();
    const icon = new URL('/icons/app-logo-192.png', SITE_URL).toString();
    const badge = new URL('/icons/notification-badge-96.png', SITE_URL).toString();
    const result = { fcmSent: 0, fcmFailed: 0, oneSignalAccepted: 0 };

    for (let offset = 0; offset < fcmTargets.length; offset += 500) {
      const batchTargets = fcmTargets.slice(offset, offset + 500);
      const sendResult = await getMessaging().sendEachForMulticast({
        notification: { title, body },
        data: { type: 'event_reminder', eventId, clickAction },
        tokens: batchTargets.map((target) => target.token),
        webpush: {
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
          contents: { en: body },
          url: notificationUrl,
          chrome_web_icon: icon,
          chrome_web_badge: badge,
          data: { type: 'event_reminder', eventId, clickAction },
        }),
      });
      const responseText = await oneSignalResponse.text();
      if (!oneSignalResponse.ok) {
        throw new Error(`OneSignal ${oneSignalResponse.status}: ${responseText.slice(0, 300)}`);
      }
      result.oneSignalAccepted = oneSignalIds.size;
    }

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
    console.error('[notify-event-published]', error);
    return reply(500, {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send publication notification',
    });
  }
};
