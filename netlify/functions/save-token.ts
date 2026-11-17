// Netlify Function: 保存 FCM Token
import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from './_shared/firestoreMonitoring';

const headers = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
};

const reply = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

const initializeAdmin = (): boolean => {
  if (getApps().length) return true;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) {
    console.error('[save-token] FIREBASE_SERVICE_ACCOUNT not configured');
    return false;
  }

  try {
    initializeApp({ credential: cert(JSON.parse(serviceAccount)) });
    return true;
  } catch (error) {
    console.error('[save-token] Failed to initialize Firebase Admin:', error);
    return false;
  }
};

export const eventHandler: Handler = async (event) => {
  // 只允许 POST 请求
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Method not allowed' });
  }

  try {
    if (!initializeAdmin()) return reply(503, { success: false, code: 'SERVICE_UNAVAILABLE' });

    let input: any;
    try {
      input = JSON.parse(event.body || '{}');
    } catch {
      return reply(400, { success: false, code: 'INVALID_REQUEST' });
    }

    const { token, userId, deviceId, deviceInfo } = input;

    if (!token || !userId) {
      return reply(400, { success: false, code: 'MISSING_REQUIRED_FIELDS' });
    }

    const db = getFirestore();
    const tokensRef = db.collection('users').doc(userId).collection('fcmTokens');

    const tokenData = {
      token,
      deviceId: deviceId || null, // ✅ 添加设备 ID
      deviceInfo: deviceInfo || {},
      createdAt: new Date(),
      lastUsed: new Date(),
      active: true
    };

    // ✅ 优先使用设备 ID 查询（如果提供）
    // 注意：允许多个不同 device ID 的 token 文档共存，每个设备有独立的 token
    if (deviceId) {
      const existingDeviceSnapshot = await tokensRef.where('deviceId', '==', deviceId).get();
      
      if (!existingDeviceSnapshot.empty) {
        // ✅ 找到相同设备 ID 的 Token（可能有多个，只保留最新的）
        const deviceDocs = existingDeviceSnapshot.docs;
        
        if (deviceDocs.length > 1) {
          // 如果同一个设备 ID 有多个文档，只保留最新的，其他的标记为 inactive
          const sortedDocs = deviceDocs.sort((a, b) => {
            const aTime = a.data().lastUsed?.toDate?.() || a.data().createdAt?.toDate?.() || new Date(0);
            const bTime = b.data().lastUsed?.toDate?.() || b.data().createdAt?.toDate?.() || new Date(0);
            return bTime.getTime() - aTime.getTime();
          });
          
          // 保留最新的，其他的标记为 inactive
          for (let i = 1; i < sortedDocs.length; i++) {
            await tokensRef.doc(sortedDocs[i].id).set({
              active: false
            }, { merge: true });
          }
          
          // 更新最新的文档
          await tokensRef.doc(sortedDocs[0].id).set({
            ...tokenData,
            lastUsed: new Date()
          }, { merge: true });
        } else {
          // 只有一个文档，直接更新
          const docId = deviceDocs[0].id;
          await tokensRef.doc(docId).set({
            ...tokenData,
            lastUsed: new Date()
          }, { merge: true });
        }
      } else {
        // ✅ 没有找到相同设备 ID 的 Token，创建新文档
        // 注意：即使存在相同 token（其他设备的），也创建新文档，因为不同设备应该有不同的 token
        // 允许多个不同 device ID 的 token 文档共存
        await tokensRef.add(tokenData);
      }
    } else {
      // 如果没有设备 ID，使用原有逻辑（向后兼容）
      const existingSnapshot = await tokensRef.where('token', '==', token).limit(1).get();

      if (!existingSnapshot.empty) {
        // 更新现有 Token
        const docId = existingSnapshot.docs[0].id;
        await tokensRef.doc(docId).set({
          ...tokenData,
          lastUsed: new Date()
        }, { merge: true });
      } else {
        // 创建新 Token 记录
        await tokensRef.add(tokenData);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (error: any) {
    console.error('[save-token] Error:', error);
    return reply(500, { success: false, code: 'TOKEN_SAVE_FAILED' });
  }
};

export default toWebFunction(eventHandler)
