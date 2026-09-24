/// <reference lib="webworker" />

/**
 * Service Worker
 * 拦截 manifest.json 请求并动态生成
 */

import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

declare const self: ServiceWorkerGlobalScope

// 预缓存资源（由 Workbox 自动注入）
precacheAndRoute(self.__WB_MANIFEST)

// Handle FCM web push in the same worker that powers the PWA. A site can only
// have one active worker for the root scope, so keeping this here avoids the
// PWA worker shadowing firebase-messaging-sw.js in production.
self.addEventListener('push', (event: PushEvent) => {
  let payload: any = {}

  try {
    payload = event.data?.json() || {}
  } catch {
    payload = { data: { body: event.data?.text() || '' } }
  }

  const notification = payload.notification || {}
  const data = payload.data || {}
  const title = notification.title || data.title || 'Macanudo Socials'
  const body = notification.body || data.body || ''
  const clickAction = data.clickAction || '/'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/app-logo-192.png',
      badge: '/icons/app-logo-192.png',
      tag: data.tag || 'macanudo-notification',
      data: { ...data, clickAction },
      requireInteraction: false,
      silent: false,
    }),
  )
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  const clickAction = event.notification.data?.clickAction || '/'
  event.notification.close()

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.postMessage({ type: 'NOTIFICATION_CLICK', action: clickAction })
          return
        }
      }

      return self.clients.openWindow(clickAction)
    }),
  )
})

// 拦截 manifest.json 请求
registerRoute(
  ({ url }) => url.pathname === '/manifest.json',
  async () => {
    try {
      // 从 IndexedDB 读取 appConfig
      const appConfig = await getAppConfigFromIndexedDB()
      
      // 生成动态 manifest
      const manifest = generateDynamicManifest(appConfig)
      
      // 返回 JSON 响应
      return new Response(JSON.stringify(manifest), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        }
      })
    } catch (error) {
      console.error('[SW] 生成 manifest 失败:', error)
      // 降级：返回默认 manifest
      return new Response(JSON.stringify(getDefaultManifest()), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        }
      })
    }
  }
)

// 缓存字体文件（Cache First）
registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({
    cacheName: 'google-fonts-stylesheets',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
      }),
    ],
  })
)

// 缓存图片（Cache First）
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'images',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
      }),
    ],
  })
)

// 静态资源（Stale While Revalidate）
registerRoute(
  ({ request }) => ['script', 'style'].includes(request.destination),
  new StaleWhileRevalidate({
    cacheName: 'static-resources',
  })
)

/**
 * 从 IndexedDB 读取 appConfig（Service Worker 环境）
 */
async function getAppConfigFromIndexedDB(): Promise<any | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('CigarAppDB', 1)
    
    request.onerror = () => {
      console.warn('[SW] IndexedDB 打开失败，使用默认配置')
      resolve(null)
    }
    
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction(['appConfig'], 'readonly')
      const store = transaction.objectStore('appConfig')
      const getRequest = store.get('current')
      
      getRequest.onsuccess = () => {
        const result = getRequest.result
        resolve(result?.config || null)
      }
      
      getRequest.onerror = () => {
        console.warn('[SW] 读取 appConfig 失败，使用默认配置')
        resolve(null)
      }
    }
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains('appConfig')) {
        db.createObjectStore('appConfig', { keyPath: 'id' })
      }
    }
  })
}

/**
 * 生成动态 manifest（Service Worker 环境）
 */
function generateDynamicManifest(appConfig: any): any {
  const appName = appConfig?.appName || 'Macanudo Socials'

  // Keep install icons local and dimensionally accurate. The manifest can be
  // requested before remote app configuration or the service worker is ready.
  const defaultIcons = [
    {
      src: '/icons/app-logo-192.png',
      sizes: '192x192',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: '/icons/app-logo-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'any'
    },
    {
      src: '/icons/app-logo-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable'
    }
  ]

  return {
    name: appName,
    short_name: 'MS',
    description: 'Premium Macanudo Socials membership platform',
    id: '/',
    start_url: '/',
    display: 'standalone',
    background_color: '#1A1A1A',
    theme_color: '#D4AF37',
    orientation: 'portrait-primary',
    scope: '/',
    lang: 'zh-CN',
    categories: ['lifestyle', 'business', 'entertainment'],
    related_applications: [{
      platform: 'webapp',
      url: '/manifest.json',
      id: '/'
    }],
    icons: defaultIcons
  }
}

/**
 * 获取默认 manifest（降级方案）
 */
function getDefaultManifest(): any {
  return generateDynamicManifest(null)
}

