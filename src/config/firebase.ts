// Firebase配置文件
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// Firebase配置
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// 运行时校验：避免无效/缺失配置导致难以定位的问题
// measurementId 是可选的，不参与验证
const requiredConfig = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  messagingSenderId: firebaseConfig.messagingSenderId,
  appId: firebaseConfig.appId
};

const missingKeys = Object.entries(requiredConfig)
  .filter(([_, v]) => !v)
  .map(([k]) => {
    // 将 camelCase 转换为 UPPER_SNAKE_CASE
    const envKey = `VITE_FIREBASE_${k.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
    return envKey;
  });

if (missingKeys.length > 0) {
  throw new Error(
    `Firebase 配置缺失，请检查环境变量: ${missingKeys.join(', ')}\n` +
    `请确保在项目根目录创建 .env.local 文件并配置这些变量。\n` +
    `可以参考 env.example 文件。`
  );
}

// 初始化Firebase（防止 Vite HMR 重复初始化）
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// 初始化Firebase服务
// try-catch 防止 Vite HMR 重复调用 initializeFirestore 报错
// 使用内存缓存，避免 IndexedDB 多标签协调触发 Firestore 内部状态错误。
// HMR 重新执行时 fallback 到已经初始化的 Firestore 实例。
export const db = (() => {
  try {
    return initializeFirestore(app, {
      localCache: memoryLocalCache()
    });
  } catch {
    return getFirestore(app);
  }
})();
export const auth = getAuth(app);
export const storage = getStorage(app);

// Messaging 服务延迟初始化（需要在 Service Worker 注册后）
export const getMessagingInstance = async () => {
  if (typeof window === 'undefined') return null;
  
  try {
    const { getMessaging, isSupported } = await import('firebase/messaging');
    const supported = await isSupported();
    if (!supported) return null;
    
    // Service Worker 路径
    const messaging = getMessaging(app);
    return messaging;
  } catch (error) {
    console.error('[Firebase] Failed to initialize messaging:', error);
    return null;
  }
};

export default app;
