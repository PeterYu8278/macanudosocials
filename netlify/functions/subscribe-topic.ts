// Netlify Function: 订阅/取消订阅主题
import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';

const initializeAdmin = () => {
  if (getApps().length) return;
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT not configured');
  initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
};

const verifyAuthenticatedCaller = async (authorization: string | undefined): Promise<void> => {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) throw new Error('UNAUTHENTICATED');
  initializeAdmin();
  await getAuth().verifyIdToken(token);
};

export const eventHandler: Handler = async (event) => {
  // 只允许 POST 请求
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    await verifyAuthenticatedCaller(event.headers['authorization']);
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const { token, topic, action } = JSON.parse(event.body || '{}');

    if (!token || !topic || !action) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: token, topic, action' })
      };
    }

    if (action !== 'subscribe' && action !== 'unsubscribe') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid action. Must be "subscribe" or "unsubscribe"' })
      };
    }

    initializeAdmin();
    const messaging = getMessaging();

    if (action === 'subscribe') {
      await messaging.subscribeToTopic([token], topic);
    } else {
      await messaging.unsubscribeFromTopic([token], topic);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, action, topic })
    };
  } catch (error: any) {
    console.error('[subscribe-topic] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};

export default toWebFunction(eventHandler)
