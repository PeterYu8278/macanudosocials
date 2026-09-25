// Firebase Cloud Messaging 服务
import { getMessaging, getToken, onMessage, isSupported, Messaging } from 'firebase/messaging';
import { getAuth } from 'firebase/auth';
import { auth, db } from '../../config/firebase';
import { collection, doc, setDoc, getDocs, query, where, deleteDoc } from 'firebase/firestore';
import type { User } from '../../types';

// VAPID 公钥（从环境变量读取）
const VAPID_KEY = import.meta.env.VITE_FCM_VAPID_KEY;
const PUSH_WORKER_URL = '/sw.js?push-worker=2';

let messagingInstance: Messaging | null = null;

/**
 * 获取或生成设备 ID
 * 使用 localStorage 持久化设备 ID，确保同一设备/浏览器使用相同的 ID
 */
const getOrCreateDeviceId = (): string => {
  const STORAGE_KEY = 'fcm_device_id';
  
  try {
    // 尝试从 localStorage 获取现有设备 ID
    const existingDeviceId = localStorage.getItem(STORAGE_KEY);
    if (existingDeviceId) {
      return existingDeviceId;
    }
    
    // 生成新的设备 ID（使用 UUID v4 格式）
    const newDeviceId = generateDeviceId();
    
    // 保存到 localStorage
    localStorage.setItem(STORAGE_KEY, newDeviceId);
    
    return newDeviceId;
  } catch (error) {
    // 如果 localStorage 不可用，生成临时 ID（每次可能不同）
    console.warn('[FCM] localStorage 不可用，使用临时设备 ID');
    return generateDeviceId();
  }
};

/**
 * 生成设备 ID（UUID v4 格式）
 */
const generateDeviceId = (): string => {
  // 使用 crypto.randomUUID() 如果可用，否则使用备用方法
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  
  // 备用方法：生成类似 UUID 的字符串
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

/**
 * 获取 Messaging 实例（单例模式）
 */
export const getMessagingInstance = async (): Promise<Messaging | null> => {
  // 检查浏览器支持
  if (!await isSupported()) {
    console.warn('[FCM] Browser does not support Firebase Cloud Messaging');
    return null;
  }

  if (!messagingInstance) {
    try {
      messagingInstance = getMessaging();
    } catch (error) {
      console.error('[FCM] Failed to initialize messaging:', error);
      return null;
    }
  }

  return messagingInstance;
};

/**
 * 请求通知权限
 */
export const requestNotificationPermission = async (): Promise<NotificationPermission> => {
  if (!('Notification' in window)) {
    console.warn('[FCM] This browser does not support notifications');
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  if (Notification.permission === 'denied') {
    return 'denied';
  }

  // 请求权限
  const permission = await Notification.requestPermission();
  return permission;
};

/**
 * 注册 Firebase Messaging Service Worker
 */
const registerFirebaseMessagingSW = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!('serviceWorker' in navigator)) {
    console.warn('[FCM] Service Worker not supported');
    return null;
  }

  try {
    // FCM shares the root PWA worker because that worker owns the app scope and
    // contains the background push handler. Always wait until it is active.
    const existingRegistration = await navigator.serviceWorker.getRegistration('/');
    const registration = existingRegistration || await navigator.serviceWorker.register(PUSH_WORKER_URL, {
      scope: '/',
    });

    if (!registration.active && registration.installing) {
      await new Promise<void>((resolve) => {
        const installing = registration.installing;
        if (!installing) {
          resolve();
          return;
        }
        
        installing.addEventListener('statechange', () => {
          // 检查 installing 是否仍然存在（可能在事件触发时变为 null）
          if (!installing || installing.state === 'activated' || installing.state === 'redundant') {
            resolve();
          }
        });
        
        // 如果已经激活，立即 resolve
        if (installing.state === 'activated') {
          resolve();
        }
      });
    } else if (!registration.active && registration.waiting) {
      await new Promise<void>((resolve) => {
        const waiting = registration.waiting;
        if (!waiting) {
          resolve();
          return;
        }
        
        waiting.addEventListener('statechange', () => {
          // 检查 waiting 是否仍然存在
          if (!waiting || waiting.state === 'activated' || waiting.state === 'redundant') {
            resolve();
          }
        });
        
        // 如果已经激活，立即 resolve
        if (waiting.state === 'activated') {
          resolve();
        }
      });
    }

    if (!registration.active) {
      await navigator.serviceWorker.ready;
    }

    return registration;
  } catch (error: any) {
    console.error('[FCM] Failed to register Firebase Messaging Service Worker:', error);
    
    // 如果注册失败，尝试使用已存在的 Service Worker
    try {
      const registration = await navigator.serviceWorker.ready;
      return registration;
    } catch (readyError) {
      console.error('[FCM] No Service Worker available:', readyError);
      // 在开发环境中，如果 Service Worker 不可用，返回 null 但不抛出错误
      if (import.meta.env.DEV) {
        console.warn('[FCM] Service Worker registration skipped in development mode');
      }
      return null;
    }
  }
};

/**
 * 获取 FCM Token
 */
export const getFCMToken = async (): Promise<string | null> => {
  try {
    const messaging = await getMessagingInstance();
    if (!messaging || !VAPID_KEY) {
      console.warn('[FCM] Messaging not available or VAPID key missing');
      return null;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.warn('[FCM] User not authenticated');
      return null;
    }

    // 请求权限
    const permission = await requestNotificationPermission();
    
    if (permission !== 'granted') {
      return null;
    }

    // 注册 Firebase Messaging Service Worker
    const swRegistration = await registerFirebaseMessagingSW();
    
    // 准备 getToken 选项
    const tokenOptions: { vapidKey: string; serviceWorkerRegistration?: ServiceWorkerRegistration } = {
      vapidKey: VAPID_KEY
    };
    
    // 如果成功注册了 Service Worker，则使用它
    if (swRegistration) {
      tokenOptions.serviceWorkerRegistration = swRegistration;
    } else {
      // 如果没有注册成功，尝试让 Firebase 使用默认的 Service Worker
      // 这在开发环境中可能会失败，但不会阻止应用运行
      if (import.meta.env.DEV) {
        console.warn('[FCM] Service Worker registration failed, trying without explicit registration');
      }
    }

    // 获取 Token
    const token = await getToken(messaging, tokenOptions);

    if (!token) {
      console.warn('[FCM] ⚠️ 未获取到注册 Token');
      return null;
    }

    return token;
  } catch (error) {
    console.error('[FCM] ❌ 获取 Token 时发生错误:', error);
    if (error instanceof Error) {
      console.error('[FCM] 错误详情:', {
        message: error.message,
        code: (error as any).code,
        stack: error.stack
      });
    }
    return null;
  }
};

/**
 * 保存 FCM Token 到 Firestore
 */
export const saveFCMToken = async (token: string, userId: string): Promise<boolean> => {
  try {
    // 获取或创建设备 ID
    const deviceId = getOrCreateDeviceId();
    
    const deviceInfo = {
      platform: navigator.platform,
      userAgent: navigator.userAgent,
      language: navigator.language
    };

    const tokenData = {
      token,
      deviceId, // ✅ 添加设备 ID
      deviceInfo,
      createdAt: new Date(),
      lastUsed: new Date(),
      active: true
    };

    // ✅ 优先检查是否已存在相同设备 ID 的 Token
    // 注意：允许多个不同 device ID 的 token 文档共存，每个设备有独立的 token
    const tokensRef = collection(db, 'users', userId, 'fcmTokens');
    const existingDeviceQuery = query(tokensRef, where('deviceId', '==', deviceId));
    const existingDeviceSnap = await getDocs(existingDeviceQuery);

    if (!existingDeviceSnap.empty) {
      // ✅ 找到相同设备 ID 的 Token（可能有多个，只保留最新的）
      // 如果同一个设备 ID 有多个 token 文档，只保留最新的一个，其他的标记为 inactive
      const deviceDocs = existingDeviceSnap.docs;
      
      if (deviceDocs.length > 1) {
        // 如果同一个设备 ID 有多个文档，只保留最新的，其他的标记为 inactive
        const sortedDocs = deviceDocs.sort((a, b) => {
          const aTime = a.data().lastUsed?.toDate?.() || a.data().createdAt?.toDate?.() || new Date(0);
          const bTime = b.data().lastUsed?.toDate?.() || b.data().createdAt?.toDate?.() || new Date(0);
          return bTime.getTime() - aTime.getTime();
        });
        
        // 保留最新的，其他的标记为 inactive
        for (let i = 1; i < sortedDocs.length; i++) {
          await setDoc(doc(db, 'users', userId, 'fcmTokens', sortedDocs[i].id), {
            active: false
          }, { merge: true });
        }
        
        // 更新最新的文档
        const latestDocId = sortedDocs[0].id;
        await setDoc(doc(db, 'users', userId, 'fcmTokens', latestDocId), {
          ...tokenData,
          lastUsed: new Date()
        }, { merge: true });
      } else {
        // 只有一个文档，直接更新
        const docId = deviceDocs[0].id;
        const existingData = deviceDocs[0].data();
        
        // 如果 token 不同，说明设备重新注册了，更新 token
        if (existingData.token !== token) {
          // Token 已变化，更新为新 Token
        }
        
        await setDoc(doc(db, 'users', userId, 'fcmTokens', docId), {
          ...tokenData,
          lastUsed: new Date()
        }, { merge: true });
      }
    } else {
      // ✅ 没有找到相同设备 ID 的 Token，创建新文档
      // 注意：即使存在相同 token（其他设备的），也创建新文档，因为不同设备应该有不同的 token
      // 如果确实存在相同 token，可能是异常情况，但为了支持多设备，仍然创建新文档
      
      // 可选：检查是否存在相同的 token（用于日志记录，但不阻止创建）
      const existingTokenQuery = query(tokensRef, where('token', '==', token));
      const existingTokenSnap = await getDocs(existingTokenQuery);
      
      if (!existingTokenSnap.empty) {
        const existingTokenData = existingTokenSnap.docs[0].data();
        console.warn('[FCM] ⚠️ 发现相同的 Token 但设备 ID 不同（现有设备 ID:', existingTokenData.deviceId, '，新设备 ID:', deviceId, '），将创建新文档以支持多设备');
      }
      
      // 创建新 Token 记录（允许多个不同 device ID 的 token 文档共存）
      const tokenDocRef = doc(tokensRef);
      await setDoc(tokenDocRef, tokenData);
    }

    return true;
  } catch (error) {
    console.error('[FCM] ❌ 保存 Token 时发生错误:', error);
    if (error instanceof Error) {
      console.error('[FCM] 错误详情:', {
        message: error.message,
        code: (error as any).code,
        stack: error.stack
      });
      
      // 检查是否是权限错误
      if ((error as any).code === 'permission-denied') {
        console.error('[FCM] ⚠️ Firestore 权限错误：请检查 Firestore 安全规则，确保用户有权限写入 fcmTokens 子集合');
      }
    }
    return false;
  }
};

/**
 * 删除 FCM Token
 */
export const deleteFCMToken = async (userId: string, token: string): Promise<boolean> => {
  try {
    const tokensRef = collection(db, 'users', userId, 'fcmTokens');
    const querySnapshot = await getDocs(query(tokensRef, where('token', '==', token)));

    if (!querySnapshot.empty) {
      const docId = querySnapshot.docs[0].id;
      await deleteDoc(doc(db, 'users', userId, 'fcmTokens', docId));
      return true;
    }

    return false;
  } catch (error) {
    console.error('[FCM] Error deleting token:', error);
    return false;
  }
};

/**
 * 获取当前设备存储在 Firestore 中的 FCM Token
 * 用于调试和测试
 */
export const getCurrentDeviceFCMToken = async (userId: string): Promise<string | null> => {
  try {
    const deviceId = getOrCreateDeviceId();
    const tokensRef = collection(db, 'users', userId, 'fcmTokens');
    
    // 使用设备 ID 查询
    const deviceIdQuery = query(
      tokensRef,
      where('deviceId', '==', deviceId),
      where('active', '==', true)
    );
    const deviceIdSnapshot = await getDocs(deviceIdQuery);
    
    if (!deviceIdSnapshot.empty) {
      const docSnap = deviceIdSnapshot.docs[0];
      const data = docSnap.data();
      return data.token as string;
    }
    
    // 如果没有找到，查询所有活跃的 token
    const activeTokensQuery = query(
      tokensRef,
      where('active', '==', true)
    );
    const snapshot = await getDocs(activeTokensQuery);
    
    if (!snapshot.empty) {
      const tokens = snapshot.docs
        .map(doc => {
          const data = doc.data();
          return {
            token: data.token as string,
            lastUsed: data.lastUsed
          };
        })
        .sort((a, b) => {
          const aTime = a.lastUsed?.toDate?.() || new Date(0);
          const bTime = b.lastUsed?.toDate?.() || new Date(0);
          return bTime.getTime() - aTime.getTime();
        });
      
      if (tokens.length > 0) {
        return tokens[0].token;
      }
    }
    
    return null;
  } catch (error) {
    console.error('[FCM] 获取当前设备 Token 时出错:', error);
    return null;
  }
};

/**
 * 检查 Firestore 中是否已存在当前设备的 FCM Token
 * 优先使用设备 ID 匹配，如果没有设备 ID 则回退到 token 匹配
 */
const getExistingFCMToken = async (userId: string): Promise<{ token: string; docId: string } | null> => {
  try {
    const deviceId = getOrCreateDeviceId();
    const tokensRef = collection(db, 'users', userId, 'fcmTokens');
    
    // ✅ 优先使用设备 ID 查询（更准确）
    const deviceIdQuery = query(
      tokensRef,
      where('deviceId', '==', deviceId),
      where('active', '==', true)
    );
    const deviceIdSnapshot = await getDocs(deviceIdQuery);
    
    if (!deviceIdSnapshot.empty) {
      // 找到当前设备的 Token
      const docSnap = deviceIdSnapshot.docs[0];
      const data = docSnap.data();
      return {
        token: data.token as string,
        docId: docSnap.id
      };
    }
    
    // 如果没有找到设备 ID 匹配的 Token，回退到查询所有活跃的 token
    // 这种情况可能发生在设备 ID 功能添加之前已存在的 token
    const activeTokensQuery = query(
      tokensRef,
      where('active', '==', true)
    );
    const snapshot = await getDocs(activeTokensQuery);
    
    if (!snapshot.empty) {
      // 找到所有活跃的 token，按 lastUsed 排序，返回最近使用的
      const tokens = snapshot.docs
        .map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            token: data.token as string,
            lastUsed: data.lastUsed
          };
        })
        .sort((a, b) => {
          const aTime = a.lastUsed?.toDate?.() || new Date(0);
          const bTime = b.lastUsed?.toDate?.() || new Date(0);
          return bTime.getTime() - aTime.getTime();
        });
      
      if (tokens.length > 0) {
        return {
          token: tokens[0].token,
          docId: tokens[0].id
        };
      }
    }
    
    return null;
  } catch (error) {
    console.warn('[FCM] 检查现有 Token 时出错:', error);
    return null;
  }
};

/**
 * 初始化推送通知（获取 Token 并保存）
 * 无论用户是否在设置中启用推送通知，都会自动获取并保存 Token
 * 优化：如果 Firestore 中已存在有效的 token，则只更新 lastUsed，不重新获取
 */
export const initializePushNotifications = async (user: User): Promise<boolean> => {
  try {
    // 检查 VAPID KEY
    if (!VAPID_KEY) {
      // FCM 配置是选填的，使用 warn 而不是 error
      console.warn('[FCM] ⚠️ VAPID_KEY 未配置，推送通知功能将不可用。如需使用，请配置环境变量 VITE_FCM_VAPID_KEY');
      return false;
    }
    
    // 检查浏览器支持
    const isSupportedResult = await isSupported();
    if (!isSupportedResult) {
      console.error('[FCM] ❌ 浏览器不支持 Firebase Cloud Messaging');
      return false;
    }
    
    // 检查用户认证状态
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.error('[FCM] ❌ 用户未认证，无法获取 Token');
      return false;
    }
    
    // 检查通知权限
    if (!('Notification' in window)) {
      console.error('[FCM] ❌ 浏览器不支持通知 API');
      return false;
    }
    
    const currentPermission = Notification.permission;
    
    if (currentPermission === 'denied') {
      return false;
    }
    
    // Always ask Firebase for the current token. FCM tokens can rotate when
    // the browser profile, permission, service worker, or app installation changes.
    const token = await getFCMToken();
    if (!token) {
      console.error('[FCM] ❌ 获取 FCM Token 失败');
      return false;
    }

    // 保存 Token 到 Firestore
    const saved = await saveFCMToken(token, user.id);
    if (!saved) {
      console.error('[FCM] ❌ 保存 Token 到 Firestore 失败');
      return false;
    }

    // 同时调用 Netlify Function 保存（向后端同步）
    // 在开发环境中，Netlify Functions 可能不可用，跳过同步
    if (!import.meta.env.DEV) {
      try {
        const deviceId = getOrCreateDeviceId();
        const response = await fetch('/.netlify/functions/save-token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token,
            userId: user.id,
            deviceId, // ✅ 传递设备 ID
            deviceInfo: {
              platform: navigator.platform,
              userAgent: navigator.userAgent,
              language: navigator.language
            }
          })
        });

        if (!response.ok) {
          console.warn('[FCM] Failed to sync token to backend');
        }
      } catch (error) {
        console.warn('[FCM] Error syncing token to backend:', error);
      }
    }

    return true;
  } catch (error) {
    console.error('[FCM] ❌ 初始化推送通知时发生错误:', error);
    if (error instanceof Error) {
      console.error('[FCM] 错误详情:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
    }
    return false;
  }
};

/**
 * 监听前台推送消息（应用打开时）
 */
export const onForegroundMessage = (callback: (payload: any) => void): (() => void) => {
  let disposed = false;
  let unsubscribe: (() => void) | undefined;

  void getMessagingInstance().then((messaging) => {
    if (!messaging || disposed) return;

    unsubscribe = onMessage(messaging, (payload) => {
      callback(payload);
    });
  });

  return () => {
    disposed = true;
    unsubscribe?.();
  };
};

/**
 * Foreground FCM messages are delivered to the page instead of being displayed
 * by the browser. Route them through the active PWA worker so mobile users see
 * the same system notification while the app is open.
 */
export const displayForegroundNotification = async (payload: any): Promise<void> => {
  if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;

  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) {
    console.warn('[FCM] No active root service worker for foreground notification');
    return;
  }

  const notification = payload?.notification || {};
  const data = payload?.data || {};
  await registration.showNotification(
    notification.title || data.title || 'Macanudo Socials',
    {
      body: notification.body || data.body || '',
      icon: '/icons/app-logo-192.png',
      badge: '/icons/notification-badge-96.png',
      tag: data.tag || `macanudo-${payload?.messageId || Date.now()}`,
      data: {
        ...data,
        clickAction: data.clickAction || '/profile',
      },
    },
  );
};

/**
 * 测试 FCM Token 推送通知
 * 用于调试和测试推送通知功能
 * 
 * @param options 测试选项
 * @returns Promise<{ success: boolean; message: string; data?: any }>
 * 
 * @example
 * // 在浏览器控制台运行：
 * import { testFCMToken } from '@/services/firebase/messaging';
 * testFCMToken({ title: '测试', body: '这是一条测试通知' });
 */
export const testFCMToken = async (options?: {
  title?: string;
  body?: string;
  token?: string;
}): Promise<{ success: boolean; message: string; data?: any }> => {
  try {
    const auth = getAuth();
    const userId = auth.currentUser?.uid;

    if (!userId) {
      return {
        success: false,
        message: '用户未登录，无法测试推送通知'
      };
    }

    // 获取 token
    let token: string | null = null;

    if (options?.token) {
      // 使用提供的 token
      token = options.token;
    } else {
      // 从 Firestore 获取当前设备的 token
      token = await getCurrentDeviceFCMToken(userId);

      if (!token) {
        // 如果 Firestore 中没有，获取新 token
        token = await getFCMToken();
        
        if (token) {
          // 保存新 token
          await saveFCMToken(token, userId);
        }
      }
    }

    if (!token) {
      return {
        success: false,
        message: '无法获取 FCM Token。请确保：\n1. 浏览器支持通知\n2. 已授予通知权限\n3. VAPID_KEY 已正确配置'
      };
    }

    // 在开发环境中，Netlify Functions 不可用，跳过调用
    if (import.meta.env.DEV) {
      console.warn('[FCM Test] ⚠️ 开发环境：Netlify Functions 不可用');
      
      return {
        success: false,
        message: '开发环境：Netlify Functions 不可用。请在生产环境中测试，或使用 Firebase Console 发送测试通知。',
        data: { token: token }
      };
    }

    // 调用测试函数
    const response = await fetch('/.netlify/functions/test-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: token,
        title: options?.title || '测试通知',
        body: options?.body || '这是一条测试推送通知'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[FCM Test] ❌ HTTP 错误:', response.status, errorText);
      return {
        success: false,
        message: `HTTP ${response.status}: ${errorText || '未知错误'}`,
        data: { status: response.status, error: errorText }
      };
    }

    const result = await response.json();

    if (result.success) {
      return {
        success: true,
        message: '推送通知已发送！请检查设备通知。如果应用在前台，请切换到后台查看。',
        data: result
      };
    } else {
      console.error('[FCM Test] ❌ 推送通知发送失败:', result.message);
      console.error('[FCM Test] 错误代码:', result.error);
      
      if (result.error === 'messaging/registration-token-not-registered') {
        // Token 失效，获取新 token 并自动重试一次
        const newToken = await getFCMToken();
        if (newToken && newToken !== token) {
          await saveFCMToken(newToken, userId);
          
          // 自动重试一次
          try {
            const retryResponse = await fetch('/.netlify/functions/test-token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                token: newToken,
                title: options?.title || '测试通知',
                body: options?.body || '这是一条测试推送通知'
              })
            });

            if (retryResponse.ok) {
              const retryResult = await retryResponse.json();
              if (retryResult.success) {
                return {
                  success: true,
                  message: 'Token 已失效，已自动获取新 Token 并重试成功！',
                  data: { ...retryResult, tokenRefreshed: true, oldToken: token, newToken: newToken }
                };
              }
            }
          } catch (retryError) {
            console.error('[FCM Test] ⚠️ 重试时出错:', retryError);
          }
          
          return {
            success: false,
            message: `Token 已失效。已获取新 Token: ${newToken.substring(0, 20)}...\n请重新运行测试函数。`,
            data: { oldToken: token, newToken: newToken }
          };
        } else {
          console.warn('[FCM Test] ⚠️ 无法获取新 Token 或新 Token 与旧 Token 相同');
        }
      }
      
      return {
        success: false,
        message: `推送通知发送失败: ${result.message}`,
        data: result
      };
    }
  } catch (error: any) {
    console.error('[FCM Test] ❌ 测试过程中发生错误:', error);
    return {
      success: false,
      message: `测试失败: ${error.message || '未知错误'}`,
      data: error
    };
  }
};

// 在开发环境中，将测试函数暴露到全局对象，方便在控制台调用
if (import.meta.env.DEV && typeof window !== 'undefined') {
  // 使用 Object.defineProperty 确保函数可以被正确暴露
  try {
    Object.defineProperty(window, 'testFCMToken', {
      value: testFCMToken,
      writable: true,
      configurable: true,
      enumerable: true
    });
    
    Object.defineProperty(window, 'getCurrentDeviceFCMToken', {
      value: async () => {
        const auth = getAuth();
        const userId = auth.currentUser?.uid;
        if (!userId) {
          console.error('[FCM] 用户未登录');
          return null;
        }
        return await getCurrentDeviceFCMToken(userId);
      },
      writable: true,
      configurable: true,
      enumerable: true
    });
    
  } catch (error) {
    console.warn('[FCM] ⚠️ 暴露测试函数到全局对象时出错:', error);
    // 回退到直接赋值
    (window as any).testFCMToken = testFCMToken;
    (window as any).getCurrentDeviceFCMToken = async () => {
      const auth = getAuth();
      const userId = auth.currentUser?.uid;
      if (!userId) {
        console.error('[FCM] 用户未登录');
        return null;
      }
      return await getCurrentDeviceFCMToken(userId);
    };
  }
}

/**
 * 订阅主题
 */
export const subscribeToTopic = async (topic: string): Promise<boolean> => {
  try {
    const token = await getFCMToken();
    if (!token) return false;

    // 调用 Netlify Function 订阅主题
    const response = await fetch('/.netlify/functions/subscribe-topic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token,
        topic,
        action: 'subscribe'
      })
    });

    return response.ok;
  } catch (error) {
    console.error('[FCM] Error subscribing to topic:', error);
    return false;
  }
};

/**
 * 取消订阅主题
 */
export const unsubscribeFromTopic = async (topic: string): Promise<boolean> => {
  try {
    const token = await getFCMToken();
    if (!token) return false;

    // 调用 Netlify Function 取消订阅
    const response = await fetch('/.netlify/functions/subscribe-topic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token,
        topic,
        action: 'unsubscribe'
      })
    });

    return response.ok;
  } catch (error) {
    console.error('[FCM] Error unsubscribing from topic:', error);
    return false;
  }
};
