import type { Handler } from '@netlify/functions';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const allowedRoles = new Set(['admin', 'superAdmin', 'developer']);

const response = (statusCode: number, body: Record<string, unknown>) => ({
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

const verifyAdminCaller = async (authorization?: string) => {
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
  if (!role || !allowedRoles.has(role)) throw new Error('FORBIDDEN');
};

const parseOneSignalResponse = (content: string) => {
  if (!content.trim()) return {} as Record<string, unknown>;
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { errors: [`OneSignal returned a non-JSON response: ${content.slice(0, 200)}`] };
  }
};

const errorMessage = (payload: Record<string, unknown>) => {
  const errors = payload.errors;
  if (Array.isArray(errors)) return errors.map(String).join('; ');
  if (typeof errors === 'string') return errors;
  if (errors && typeof errors === 'object') return JSON.stringify(errors);
  return 'OneSignal rejected the notification';
};

const normalizeStringArray = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  : [];

const normalizeFcmData = (value: Record<string, unknown>) => Object.fromEntries(
  Object.entries(value).map(([key, item]) => [
    key,
    typeof item === 'string' ? item : JSON.stringify(item),
  ]),
);

const notificationTypePreference = (type: string) => {
  if (type === 'activity' || type === 'event_reminder') return 'activity';
  if (type === 'points') return 'points';
  if (type === 'order') return 'order';
  if (type === 'marketing') return 'marketing';
  return null;
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(200, {});
  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, error: 'Method not allowed' });
  }

  try {
    await verifyAdminCaller(event.headers.authorization);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNAUTHENTICATED';
    if (message === 'UNAUTHENTICATED') {
      return response(401, { success: false, error: 'Authentication required' });
    }
    if (message === 'FORBIDDEN') {
      return response(403, { success: false, error: 'Administrator permission required' });
    }
    console.error('[send-notification] Authentication failed:', error);
    return response(401, { success: false, error: 'Authentication failed' });
  }

  try {
    const request = JSON.parse(event.body || '{}') as Record<string, unknown>;
    const title = typeof request.title === 'string' ? request.title.trim() : '';
    const body = typeof request.body === 'string' ? request.body.trim() : '';
    const provider = request.provider === 'fcm' ? 'fcm' : 'onesignal';
    const type = typeof request.type === 'string' ? request.type : 'system';
    const clickAction = typeof request.clickAction === 'string' ? request.clickAction : '/';
    const targetUsers = normalizeStringArray(request.targetUsers);
    const targetSegments = normalizeStringArray(request.targetSegments ?? request.targetTopics);
    const customData = request.data && typeof request.data === 'object' && !Array.isArray(request.data)
      ? request.data as Record<string, unknown>
      : {};

    if (!title || !body || title.length > 100 || body.length > 500) {
      return response(400, {
        success: false,
        error: 'Title and message are required (maximum 100 and 500 characters)',
      });
    }
    if (targetUsers.length > 0 && targetSegments.length > 0) {
      return response(400, { success: false, error: 'Choose users or segments, not both' });
    }

    const appId = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!appId || !apiKey) {
      return response(503, { success: false, error: 'OneSignal is not configured' });
    }

    const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://macanudosocials.com';
    let notificationUrl: string;
    try {
      notificationUrl = new URL(clickAction, siteUrl).toString();
    } catch {
      return response(400, { success: false, error: 'Invalid click path or URL' });
    }

    let eligibleTargetUsers = targetUsers;
    if (targetUsers.length > 0) {
      const db = getFirestore();
      const preferenceKey = notificationTypePreference(type);
      const userSnapshots = await Promise.all(
        targetUsers.map((userId) => db.collection('users').doc(userId).get()),
      );

      eligibleTargetUsers = userSnapshots
        .filter((snapshot) => {
          if (!snapshot.exists) return false;
          const preferences = snapshot.data()?.preferences;
          if (preferences?.notifications === false) return false;
          if (!preferenceKey) return true;
          return preferences?.pushNotifications?.types?.[preferenceKey] !== false;
        })
        .map((snapshot) => snapshot.id);

      if (eligibleTargetUsers.length === 0) {
        return response(422, {
          success: false,
          error: 'The selected user has disabled this notification type',
          provider: 'onesignal',
        });
      }
    }

    if (provider === 'fcm') {
      const db = getFirestore();
      const tokenTargets: Array<{
        token: string;
        ref: FirebaseFirestore.DocumentReference;
      }> = [];

      const appendUserTokens = async (userId: string) => {
        const tokensSnapshot = await db.collection('users')
          .doc(userId)
          .collection('fcmTokens')
          .where('active', '==', true)
          .get();

        tokensSnapshot.forEach((tokenDocument) => {
          const token = tokenDocument.data().token;
          if (typeof token === 'string' && token.trim()) {
            tokenTargets.push({ token, ref: tokenDocument.ref });
          }
        });
      };

      if (eligibleTargetUsers.length > 0) {
        await Promise.all(eligibleTargetUsers.map(appendUserTokens));
      } else if (targetSegments.length === 0) {
        const usersSnapshot = await db.collection('users').get();
        await Promise.all(usersSnapshot.docs.map((userDocument) => appendUserTokens(userDocument.id)));
      }

      if (tokenTargets.length === 0 && targetSegments.length === 0) {
        return response(422, {
          success: false,
          error: 'No active FCM tokens were found for the selected user',
          provider: 'fcm',
        });
      }

      const messaging = getMessaging();
      const results = {
        total: 0,
        sent: 0,
        failed: 0,
        failureDetails: [] as Array<{ code?: string; message: string }>,
      };
      const fcmData = normalizeFcmData({ ...customData, type, clickAction });

      for (const topic of targetSegments) {
        try {
          await messaging.send({
            notification: { title, body },
            data: fcmData,
            topic,
            webpush: { fcmOptions: { link: notificationUrl } },
          });
          results.total += 1;
          results.sent += 1;
        } catch (error) {
          const sendError = error as { code?: string; message?: string };
          results.total += 1;
          results.failed += 1;
          results.failureDetails.push({
            code: sendError.code,
            message: sendError.message || 'FCM topic delivery failed',
          });
        }
      }

      for (let offset = 0; offset < tokenTargets.length; offset += 500) {
        const batchTargets = tokenTargets.slice(offset, offset + 500);
        const batchResponse = await messaging.sendEachForMulticast({
          notification: { title, body },
          data: fcmData,
          tokens: batchTargets.map((target) => target.token),
          webpush: { fcmOptions: { link: notificationUrl } },
        });

        results.total += batchTargets.length;
        results.sent += batchResponse.successCount;
        results.failed += batchResponse.failureCount;

        for (let index = 0; index < batchResponse.responses.length; index += 1) {
          const sendResult = batchResponse.responses[index];
          if (sendResult.success) continue;

          const code = sendResult.error?.code;
          if (
            code === 'messaging/registration-token-not-registered'
            || code === 'messaging/invalid-registration-token'
          ) {
            await batchTargets[index].ref.set({
              active: false,
              lastError: code,
              lastErrorAt: new Date(),
            }, { merge: true });
          }

          if (results.failureDetails.length < 10) {
            results.failureDetails.push({
              code,
              message: sendResult.error?.message || 'FCM token delivery failed',
            });
          }
        }
      }

      return response(results.sent > 0 ? 200 : 422, {
        success: results.sent > 0,
        provider: 'fcm',
        error: results.sent > 0 ? undefined : 'FCM could not deliver to any active token',
        results,
      });
    }

    const oneSignalPayload: Record<string, unknown> = {
      app_id: appId,
      target_channel: 'push',
      headings: { en: title },
      contents: { en: body },
      url: notificationUrl,
      data: { ...customData, type, clickAction },
    };

    if (eligibleTargetUsers.length > 0) {
      oneSignalPayload.include_aliases = { external_id: eligibleTargetUsers };
    } else {
      oneSignalPayload.included_segments = targetSegments.length > 0
        ? targetSegments
        : ['Subscribed Users'];
    }

    const oneSignalResponse = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(oneSignalPayload),
    });
    const responseBody = parseOneSignalResponse(await oneSignalResponse.text());

    if (!oneSignalResponse.ok) {
      console.error('[send-notification] OneSignal request failed:', responseBody);
      return response(oneSignalResponse.status, {
        success: false,
        error: errorMessage(responseBody),
        provider: 'onesignal',
      });
    }

    const messageId = typeof responseBody.id === 'string' ? responseBody.id : '';
    const recipients = typeof responseBody.recipients === 'number' ? responseBody.recipients : 0;
    if (!messageId) {
      return response(422, {
        success: false,
        error: 'No subscribed OneSignal recipients were found for this user',
        provider: 'onesignal',
        details: responseBody,
      });
    }

    return response(200, {
      success: true,
      provider: 'onesignal',
      messageId,
      results: {
        total: recipients,
        sent: recipients,
        failed: 0,
        failureDetails: [],
      },
    });
  } catch (error) {
    console.error('[send-notification] Error:', error);
    return response(500, {
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
};
