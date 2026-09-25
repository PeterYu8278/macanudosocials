// Firebase Cloud Messaging Service Worker
// 此文件会被复制到 dist 目录，由浏览器加载

importScripts('https://www.gstatic.com/firebasejs/12.3.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.3.0/firebase-messaging-compat.js');

// Firebase 配置（从环境变量读取，需要在前端注入）
// 这些值会在构建时通过 vite-plugin-pwa 注入
const firebaseConfig = {
  apiKey: 'AIzaSyAPqg8bUXs7KuN1_aofBE8yLNRHGL-WwHc',
  authDomain: 'cigar-56871.firebaseapp.com',
  projectId: 'cigar-56871',
  storageBucket: 'cigar-56871.firebasestorage.app',
  messagingSenderId: '866808564072',
  appId: '1:866808564072:web:54021622fc7fc9a8b22edd'
};

// 初始化 Firebase
firebase.initializeApp(firebaseConfig);

// 获取 Messaging 实例
const messaging = firebase.messaging();

// 监听后台推送消息（应用关闭或后台时）
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM Service Worker] Background message received:', payload);

  const notificationTitle = payload.notification?.title || 'MS';
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: '/icons/app-logo-192.png',
    badge: '/icons/notification-badge-96.png',
    tag: payload.data?.tag || 'default',
    data: payload.data || {},
    requireInteraction: false,
    silent: false
  };

  // 显示通知
  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// 监听通知点击事件
self.addEventListener('notificationclick', (event) => {
  console.log('[FCM Service Worker] Notification clicked:', event);

  event.notification.close();

  // 如果通知包含跳转路径，打开应用并跳转
  const clickAction = event.notification.data?.clickAction || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 如果应用已经打开，聚焦到该窗口并跳转
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            action: clickAction
          });
          return;
        }
      }
      
      // 如果应用未打开，打开新窗口
      if (clients.openWindow) {
        return clients.openWindow(clickAction);
      }
    })
  );
});

// 监听通知关闭事件
self.addEventListener('notificationclose', (event) => {
  console.log('[FCM Service Worker] Notification closed:', event);
});

