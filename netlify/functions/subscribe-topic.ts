// Netlify Function: 订阅/取消订阅主题
import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

// 初始化 Firebase Admin（如果尚未初始化）
if (!getApps().length) {
  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccount) {
      initializeApp({
        credential: cert(JSON.parse(serviceAccount))
      });
    } else {
      console.error('[subscribe-topic] FIREBASE_SERVICE_ACCOUNT not configured');
    }
  } catch (error) {
    console.error('[subscribe-topic] Failed to initialize Firebase Admin:', error);
  }
}

export const eventHandler: Handler = async (event) => {
  // 只允许 POST 请求
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
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
