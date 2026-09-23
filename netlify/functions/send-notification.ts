import type { Handler } from '@netlify/functions';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

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

    const oneSignalPayload: Record<string, unknown> = {
      app_id: appId,
      target_channel: 'push',
      headings: { en: title },
      contents: { en: body },
      url: notificationUrl,
      data: { ...customData, type, clickAction },
    };

    if (targetUsers.length > 0) {
      oneSignalPayload.include_aliases = { external_id: targetUsers };
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
