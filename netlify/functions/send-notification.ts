// Netlify Function: 发送推送通知
import { Handler } from '@netlify/functions';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
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
      console.error('[send-notification] FIREBASE_SERVICE_ACCOUNT not configured');
    }
  } catch (error) {
    console.error('[send-notification] Failed to initialize Firebase Admin:', error);
  }
}

export const handler: Handler = async (event, context) => {
  // 只允许 POST 请求
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const {
      title,
      body,
      type = 'system',
      targetUsers = [],
      targetTopics = [],
      data = {},
      clickAction
    } = JSON.parse(event.body || '{}');

    if (!title || !body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields: title, body' })
      };
    }

    const db = getFirestore();
    const messaging = getMessaging();

    const tokenTargets: Array<{ token: string; ref: FirebaseFirestore.DocumentReference }> = [];

    // 如果指定了目标用户，获取这些用户的 Token
    if (targetUsers.length > 0) {
      for (const userId of targetUsers) {
        const tokensSnapshot = await db
          .collection('users')
          .doc(userId)
          .collection('fcmTokens')
          .where('active', '==', true)
          .get();

        tokensSnapshot.forEach((doc) => {
          const tokenData = doc.data();
          if (tokenData.token) {
            tokenTargets.push({ token: tokenData.token, ref: doc.ref });
          }
        });
      }
    }

    // 如果没有指定用户，发送到所有用户（或主题）
    if (tokens.length === 0 && targetTopics.length === 0) {
      // 获取所有活跃用户的 Token
      const usersSnapshot = await db.collection('users').get();
      
      for (const userDoc of usersSnapshot.docs) {
        const tokensSnapshot = await userDoc.ref
          .collection('fcmTokens')
          .where('active', '==', true)
          .get();

        tokensSnapshot.forEach((doc) => {
          const tokenData = doc.data();
          if (tokenData.token) {
            tokenTargets.push({ token: tokenData.token, ref: doc.ref });
          }
        });
      }
    }

    const results = {
      total: 0,
      sent: 0,
      failed: 0,
      failureDetails: [] as Array<{ code?: string; message: string }>
    };

    // 如果使用主题，发送主题消息
    if (targetTopics.length > 0) {
      for (const topic of targetTopics) {
        try {
          const message = {
            notification: {
              title,
              body
            },
            data: {
              ...data,
              type,
              clickAction: clickAction || '/'
            },
            topic
          };

          await messaging.send(message);
          results.total++;
          results.sent++;
          } catch (error: any) {
          console.error(`[send-notification] Failed to send to topic ${topic}:`, error);
          results.total++;
          results.failed++;
          if (results.failureDetails.length < 10) {
            results.failureDetails.push({
              code: error?.code,
              message: error?.message || 'Topic delivery failed'
            });
          }
        }
      }
    }

    // 批量发送到 Token（每次最多 500 个）
    if (tokenTargets.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < tokenTargets.length; i += batchSize) {
        const batchTargets = tokenTargets.slice(i, i + batchSize);
        const batch = batchTargets.map((target) => target.token);

        const message = {
          notification: {
            title,
            body
          },
          data: {
            ...data,
            type,
            clickAction: clickAction || '/'
          },
          tokens: batch
        };

        try {
          const response = await messaging.sendEachForMulticast(message);
          results.total += batch.length;
          results.sent += response.successCount;
          results.failed += response.failureCount;
          for (let responseIndex = 0; responseIndex < response.responses.length; responseIndex++) {
            const sendResponse = response.responses[responseIndex];
            if (sendResponse.success) continue;

            const code = sendResponse.error?.code;
            if (code === 'messaging/registration-token-not-registered'
              || code === 'messaging/invalid-registration-token') {
              await batchTargets[responseIndex].ref.update({
                active: false,
                lastError: code,
                lastErrorAt: new Date()
              });
            }

            if (results.failureDetails.length < 10) {
              results.failureDetails.push({
                code,
                message: sendResponse.error?.message || 'Token delivery failed'
              });
            }
          }
        } catch (error: any) {
          console.error('[send-notification] Failed to send batch:', error);
          results.total += batch.length;
          results.failed += batch.length;
          if (results.failureDetails.length < 10) {
            results.failureDetails.push({
              code: error?.code,
              message: error?.message || 'Batch delivery failed'
            });
          }
        }
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: results.sent > 0,
        results
      })
    };
  } catch (error: any) {
    console.error('[send-notification] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};

