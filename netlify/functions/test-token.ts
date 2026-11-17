// Netlify Function: 测试单个 FCM Token
// 用于诊断推送通知问题
import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getMessaging } from 'firebase-admin/messaging';
import { getFirestore } from './_shared/firestoreMonitoring';

const ADMIN_ROLES = new Set(['admin', 'superAdmin', 'developer']);

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const initializeAdmin = () => {
  if (getApps().length) return;
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) throw new Error('FIREBASE_SERVICE_ACCOUNT not configured');
  initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
};

const verifyAdminCaller = async (authorization: string | undefined): Promise<void> => {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) throw new Error('UNAUTHENTICATED');
  initializeAdmin();
  const decoded = await getAuth().verifyIdToken(token);
  const db = getFirestore();
  let snap = await db.collection('users').doc(decoded.uid).get();
  if (!snap.exists && decoded.email) {
    const q = await db.collection('users').where('email', '==', decoded.email.toLowerCase()).limit(1).get();
    snap = q.docs[0] || snap;
  }
  const role = (decoded.role as string | undefined) || snap.data()?.role;
  if (!role || !ADMIN_ROLES.has(role)) throw new Error('FORBIDDEN');
};

export const eventHandler: Handler = async (event) => {
  // 处理 OPTIONS 请求（CORS 预检）
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  // 只允许 POST 请求
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    await verifyAdminCaller(event.headers['authorization']);
  } catch {
    return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const { token, title = '测试通知', body = '这是一条测试推送通知' } = JSON.parse(event.body || '{}');

    initializeAdmin();

    if (!token) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Missing required field: token',
          message: '请提供 FCM token'
        })
      };
    }

    // 验证 token 格式
    if (typeof token !== 'string' || token.length < 10) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: 'Invalid token format',
          message: 'Token 格式无效'
        })
      };
    }

    const messaging = getMessaging();

    // 构建消息
    const message = {
      notification: {
        title,
        body
      },
      data: {
        type: 'test',
        timestamp: new Date().toISOString(),
        clickAction: '/'
      },
      token: token.trim(),
      webpush: {
        fcmOptions: {
          link: '/'
        },
        notification: {
          icon: '/icons/app-logo-192.png',
          badge: '/icons/notification-badge-96.png',
          requireInteraction: false,
          silent: false
        }
      }
    };

    // 发送消息
    let messageId: string;
    try {
      messageId = await messaging.send(message);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          messageId,
          message: '推送通知已发送',
          details: {
            token: token.substring(0, 20) + '...',
            title,
            body,
            sentAt: new Date().toISOString()
          }
        })
      };
    } catch (sendError: any) {
      console.error('[test-token] ❌ 发送失败:', sendError);
      
      // 解析 Firebase 错误代码
      let errorMessage = '发送失败';
      let errorCode = sendError.code || 'unknown';
      
      if (errorCode === 'messaging/invalid-registration-token') {
        errorMessage = 'Token 无效或已过期，请重新获取 token';
      } else if (errorCode === 'messaging/registration-token-not-registered') {
        errorMessage = 'Token 未注册，设备可能已卸载应用或 token 已失效';
      } else if (errorCode === 'messaging/invalid-argument') {
        errorMessage = '消息格式无效';
      } else if (errorCode === 'messaging/unavailable') {
        errorMessage = 'FCM 服务暂时不可用，请稍后重试';
      } else if (errorCode === 'messaging/internal-error') {
        errorMessage = 'FCM 内部错误';
      } else {
        errorMessage = sendError.message || '未知错误';
      }

      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: errorCode,
          message: errorMessage,
          details: {
            token: token.substring(0, 20) + '...',
            fullError: sendError.message,
            stack: sendError.stack
          }
        })
      };
    }
  } catch (error: any) {
    console.error('[test-token] ❌ 处理请求时出错:', error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message || '服务器内部错误',
        details: error.stack
      })
    };
  }
};

export default toWebFunction(eventHandler)
