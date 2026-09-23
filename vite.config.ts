/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'path'
import { mkdirSync, copyFileSync } from 'fs'
import { existsSync } from 'fs'
import { execSync } from 'child_process'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    // Inject Service Worker config before build
    {
      name: 'inject-sw-config',
      buildStart() {
        try {
          // 只在生产构建时注入（开发环境使用环境变量）
          if (process.env.NODE_ENV === 'production' || process.env.VITE_APP_ENV === 'production') {
            execSync('node scripts/inject-sw-config.js', { stdio: 'inherit' })
          }
        } catch (error) {
          console.warn('⚠️  Service Worker config injection skipped (development mode)')
        }
      }
    },
    // Ensure dist directory exists before PWA plugin runs
    {
      name: 'ensure-dist-exists',
      buildStart() {
        const distDir = resolve(__dirname, 'dist')
        if (!existsSync(distDir)) {
          mkdirSync(distDir, { recursive: true })
        }
      }
    },
    // Copy firebase-messaging-sw.js to dist directory
    {
      name: 'copy-firebase-messaging-sw',
      closeBundle() {
        const swSource = resolve(__dirname, 'public/firebase-messaging-sw.js')
        const swDest = resolve(__dirname, 'dist/firebase-messaging-sw.js')
        if (existsSync(swSource)) {
          copyFileSync(swSource, swDest)
          console.log('✅ Copied firebase-messaging-sw.js to dist')
        } else {
          console.warn('⚠️  firebase-messaging-sw.js not found in public directory')
        }
      }
    },
    react({
      // 禁用React DevTools提示
      jsxRuntime: 'automatic',
    }),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: [
        'icons/app-logo-192.png',
        'icons/app-logo-512.png',
        'icons/app-logo-maskable-512.png',
        'icons/apple-touch-icon-180.png',
      ],
      selfDestroying: true, // 允许Service Worker自毁
      strategies: 'injectManifest', // 使用 injectManifest 策略以支持自定义 Service Worker
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json}'],
        maximumFileSizeToCacheInBytes: 3000000, // 3MB
      },
      manifest: {
        name: 'Macanudo Socials',
        short_name: 'MS',
        description: 'Premium Macanudo Socials membership platform',
        theme_color: '#D4AF37',
        background_color: '#1A1A1A',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        icons: [
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
      },
      // 注意：使用 injectManifest 策略时，workbox 配置在 injectManifest 中
      // 自定义逻辑在 src/sw.ts 中实现
      devOptions: {
        enabled: false, // 开发环境禁用PWA
        type: 'module'
      }
    })
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@ant-design/cssinjs',
      '@ant-design/cssinjs-utils',
    ],
  },
  server: {
    port: parseInt(process.env.PORT || '3000'),
    open: true,
    proxy: {
      '/.netlify/functions': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      }
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.onesignal.com https://api.onesignal.com https://apis.google.com https://www.gstatic.com https://www.googletagmanager.com https://www.google-analytics.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https: https://lh3.googleusercontent.com https://lh4.googleusercontent.com https://lh5.googleusercontent.com https://lh6.googleusercontent.com; connect-src 'self' blob: https://*.onesignal.com https://*.firebaseio.com https://firestore.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://firebasestorage.googleapis.com https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://fcm.googleapis.com https://*.cloudinary.com https://*.whapi.cloud https://gate.whapi.cloud https://www.google-analytics.com https://www.googletagmanager.com https://generativelanguage.googleapis.com https://www.googleapis.com https://*.billplz.com https://*.billplz-sandbox.com wss://*.firebaseio.com; frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://content-firebaseappcheck.googleapis.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; manifest-src 'self' blob:; upgrade-insecure-requests; block-all-mixed-content;"
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }

          const normalizedId = id.replace(/\\/g, '/')

          if (
            /\/node_modules\/(react|react-dom|react-is|react-router|react-router-dom|react-i18next|react-[^/]+|swiper|zustand|rc-[^/]+)\//.test(normalizedId) ||
            normalizedId.includes('/node_modules/antd/') ||
            normalizedId.includes('/node_modules/@ant-design/') ||
            normalizedId.includes('/node_modules/@ant-design/v5-patch-for-react-19/') ||
            normalizedId.includes('/node_modules/@ant-design/cssinjs/') ||
            normalizedId.includes('/node_modules/@ant-design/cssinjs-utils/') ||
            normalizedId.includes('/node_modules/@rc-component/')
          ) {
            return 'vendor-react'
          }

          if (
            normalizedId.includes('/node_modules/antd/') ||
            normalizedId.includes('/node_modules/@ant-design/') ||
            normalizedId.includes('/node_modules/@rc-component/') ||
            /\/node_modules\/rc-[^/]+\//.test(normalizedId)
          ) {
            return 'vendor-antd'
          }

          if (
            normalizedId.includes('/node_modules/@firebase/firestore/') ||
            normalizedId.includes('/node_modules/firebase/firestore/')
          ) {
            return 'vendor-firebase-firestore'
          }

          if (normalizedId.includes('/node_modules/@firebase/auth/') || normalizedId.includes('/node_modules/firebase/auth/')) {
            return 'vendor-firebase-auth'
          }

          if (
            normalizedId.includes('/node_modules/@firebase/storage/') ||
            normalizedId.includes('/node_modules/@firebase/messaging/') ||
            normalizedId.includes('/node_modules/firebase/storage/') ||
            normalizedId.includes('/node_modules/firebase/messaging/')
          ) {
            return 'vendor-firebase-extra'
          }

          if (normalizedId.includes('/node_modules/@firebase/') || normalizedId.includes('/node_modules/firebase/')) {
            return 'vendor-firebase-core'
          }

          if (normalizedId.includes('/node_modules/xlsx/')) {
            return 'vendor-xlsx'
          }

          if (normalizedId.includes('/node_modules/html2canvas/')) {
            return 'vendor-html2canvas'
          }

          if (normalizedId.includes('/node_modules/jspdf/') || normalizedId.includes('/node_modules/jspdf-autotable/')) {
            return 'vendor-jspdf'
          }

          if (
            normalizedId.includes('/node_modules/dayjs/') ||
            normalizedId.includes('/node_modules/axios/') ||
            normalizedId.includes('/node_modules/i18next/')
          ) {
            return 'vendor-utils'
          }

          if (
            normalizedId.includes('/node_modules/html5-qrcode/') ||
            normalizedId.includes('/node_modules/qrcode/')
          ) {
            return 'vendor-media'
          }

          return undefined
        }
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: [],
  },
})
