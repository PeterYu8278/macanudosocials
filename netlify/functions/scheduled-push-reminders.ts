import { schedule } from '@netlify/functions';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const TIME_ZONE = 'Asia/Singapore';
const SITE_URL = process.env.URL || 'https://macanudosocials.com';
const INVALID_FCM_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

type ReminderType = 'event_reminder' | 'vip_expiry';

interface UserTarget {
  id: string;
  data: FirebaseFirestore.DocumentData;
}

interface PushResult {
  fcmSent: number;
  fcmFailed: number;
  oneSignalAccepted: number;
}

const getAdminDb = () => {
  if (!getApps().length) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawServiceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
    initializeApp({ credential: cert(JSON.parse(rawServiceAccount)) });
  }
  return getFirestore();
};

const zonedDateParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);

  return { year: value('year'), month: value('month'), day: value('day') };
};

// Singapore has no daylight-saving changes, so local midnight is always 16:00 UTC.
const singaporeDayRange = (daysFromToday: number) => {
  const today = zonedDateParts(new Date());
  const localDate = new Date(Date.UTC(today.year, today.month - 1, today.day + daysFromToday));
  const start = new Date(Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
    -8,
  ));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
};

const formatEnglishDate = (date: Date) => {
  const { year, month, day } = zonedDateParts(date);
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

const allowsNotification = (user: FirebaseFirestore.DocumentData, type: ReminderType) => {
  const preferences = user.preferences;
  if (preferences?.notifications === false) return false;
  if (type === 'event_reminder') {
    return preferences?.pushNotifications?.types?.activity !== false;
  }
  return true;
};

const claimDispatch = async (dispatchId: string, details: Record<string, unknown>) => {
  const db = getAdminDb();
  const ref = db.collection('scheduledNotificationDispatches').doc(dispatchId);
  try {
    await ref.create({
      ...details,
      status: 'processing',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return ref;
  } catch (error: any) {
    if (error?.code === 6 || error?.code === 'already-exists') return null;
    throw error;
  }
};

const sendPush = async (
  users: UserTarget[],
  title: string,
  body: string,
  type: ReminderType,
  clickAction: string,
  data: Record<string, string>,
): Promise<PushResult> => {
  const db = getAdminDb();
  const fcmTargets: Array<{ token: string; ref: FirebaseFirestore.DocumentReference }> = [];
  const oneSignalSubscriptionIds = new Set<string>();

  await Promise.all(users.map(async (user) => {
    const fcmSnapshot = await db.collection('users').doc(user.id)
      .collection('fcmTokens').where('active', '==', true).get();

    fcmSnapshot.forEach((tokenDocument) => {
      const token = tokenDocument.data().token;
      if (typeof token === 'string' && token.trim()) {
        fcmTargets.push({ token: token.trim(), ref: tokenDocument.ref });
      }
    });

    // Prefer FCM for a user to avoid duplicate notifications on the same device.
    if (!fcmSnapshot.empty) return;

    const subscriptions = await db.collection('users').doc(user.id)
      .collection('notificationSubscriptions').get();
    subscriptions.forEach((subscription) => {
      const subscriptionData = subscription.data();
      if (
        subscriptionData.provider === 'onesignal'
        && subscriptionData.status === 'subscribed'
        && subscriptionData.optedIn === true
        && typeof subscriptionData.subscriptionId === 'string'
      ) {
        oneSignalSubscriptionIds.add(subscriptionData.subscriptionId.trim());
      }
    });
  }));

  const result: PushResult = { fcmSent: 0, fcmFailed: 0, oneSignalAccepted: 0 };
  const notificationUrl = new URL(clickAction, SITE_URL).toString();
  const icon = new URL('/icons/app-logo-192.png', SITE_URL).toString();
  const badge = new URL('/icons/notification-badge-96.png', SITE_URL).toString();

  for (let offset = 0; offset < fcmTargets.length; offset += 500) {
    const batchTargets = fcmTargets.slice(offset, offset + 500);
    const response = await getMessaging().sendEachForMulticast({
      notification: { title, body },
      data: { ...data, type, clickAction },
      tokens: batchTargets.map((target) => target.token),
      webpush: {
        fcmOptions: { link: notificationUrl },
        notification: { icon, badge },
      },
    });
    result.fcmSent += response.successCount;
    result.fcmFailed += response.failureCount;

    await Promise.all(response.responses.map(async (sendResult, index) => {
      const code = sendResult.error?.code;
      if (!sendResult.success && code && INVALID_FCM_CODES.has(code)) {
        await batchTargets[index].ref.set({
          active: false,
          lastError: code,
          lastErrorAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    }));
  }

  if (oneSignalSubscriptionIds.size > 0) {
    const appId = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!appId || !apiKey) {
      console.warn('[scheduled-push-reminders] OneSignal fallback is not configured');
    } else {
      const response = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: appId,
          target_channel: 'push',
          include_subscription_ids: [...oneSignalSubscriptionIds],
          headings: { en: title },
          contents: { en: body },
          url: notificationUrl,
          chrome_web_icon: icon,
          chrome_web_badge: badge,
          data: { ...data, type, clickAction },
        }),
      });
      const responseText = await response.text();
      if (!response.ok) throw new Error(`OneSignal ${response.status}: ${responseText.slice(0, 300)}`);
      result.oneSignalAccepted = oneSignalSubscriptionIds.size;
    }
  }

  return result;
};

const processEventReminders = async (users: UserTarget[]) => {
  const db = getAdminDb();
  const tomorrow = singaporeDayRange(1);
  const events = await db.collection('events')
    .where('schedule.startDate', '>=', Timestamp.fromDate(tomorrow.start))
    .where('schedule.startDate', '<', Timestamp.fromDate(tomorrow.end))
    .get();
  const eligibleUsers = users.filter((user) => allowsNotification(user.data, 'event_reminder'));
  let sent = 0;

  for (const event of events.docs) {
    const eventData = event.data();
    if (['draft', 'cancelled', 'completed'].includes(eventData.status)) continue;

    const dateKey = zonedDateParts(tomorrow.start);
    const dispatchId = `event-${event.id}-${dateKey.year}${dateKey.month}${dateKey.day}`;
    const dispatchRef = await claimDispatch(dispatchId, {
      type: 'event_reminder',
      eventId: event.id,
      scheduledFor: Timestamp.fromDate(tomorrow.start),
    });
    if (!dispatchRef) continue;

    try {
      const result = await sendPush(
        eligibleUsers,
        'Cigar Gathering Reminder',
        'Cigar Gathering is tomorrow at 7pm! Limited seats - register now!',
        'event_reminder',
        '/events',
        { eventId: event.id },
      );
      await dispatchRef.set({ status: 'completed', result, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      sent++;
    } catch (error) {
      await dispatchRef.set({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      throw error;
    }
  }

  return { matched: events.size, sent };
};

const processMembershipReminders = async (users: UserTarget[]) => {
  const db = getAdminDb();
  const usersById = new Map(users.map((user) => [user.id, user]));
  const result = { matched: 0, sent: 0 };

  for (const daysBefore of [7, 3, 1]) {
    const expiryRange = singaporeDayRange(daysBefore);
    const records = await db.collection('membershipFeeRecords')
      .where('status', '==', 'pending')
      .where('dueDate', '>=', Timestamp.fromDate(expiryRange.start))
      .where('dueDate', '<', Timestamp.fromDate(expiryRange.end))
      .get();
    result.matched += records.size;

    for (const record of records.docs) {
      const recordData = record.data();
      const user = usersById.get(recordData.userId);
      if (!user || !allowsNotification(user.data, 'vip_expiry')) continue;

      const dispatchId = `annual-pass-${record.id}-${daysBefore}d`;
      const dispatchRef = await claimDispatch(dispatchId, {
        type: 'vip_expiry',
        userId: user.id,
        membershipFeeRecordId: record.id,
        daysBefore,
        scheduledFor: Timestamp.fromDate(expiryRange.start),
      });
      if (!dispatchRef) continue;

      try {
        const expiryDate = recordData.dueDate instanceof Timestamp
          ? recordData.dueDate.toDate()
          : new Date(recordData.dueDate);
        const pushResult = await sendPush(
          [user],
          'Annual Pass Expiry Reminder',
          `Your Annual Pass will expire on ${formatEnglishDate(expiryDate)}. Renew now to continue enjoying your member benefits.`,
          'vip_expiry',
          '/profile',
          { membershipFeeRecordId: record.id, daysBefore: String(daysBefore) },
        );
        await dispatchRef.set({ status: 'completed', result: pushResult, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        result.sent++;
      } catch (error) {
        await dispatchRef.set({
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        throw error;
      }
    }
  }

  return result;
};

const runScheduledReminders = async () => {
  const db = getAdminDb();
  const usersSnapshot = await db.collection('users').get();
  const users = usersSnapshot.docs.map((document) => ({ id: document.id, data: document.data() }));

  const [events, memberships] = await Promise.all([
    processEventReminders(users),
    processMembershipReminders(users),
  ]);
  const result = { timeZone: TIME_ZONE, events, memberships };
  console.log('[scheduled-push-reminders]', result);
  return { statusCode: 200, body: JSON.stringify(result) };
};

// Netlify cron is UTC. 04:00 UTC is 12:00 in Singapore.
export const handler = schedule('0 4 * * *', runScheduledReminders);
