/**
 * 动态 Manifest 生成工具
 * 用于根据 appConfig 动态生成 PWA manifest
 */
import type { AppConfig } from '../types'

export interface DynamicManifest {
  name: string
  short_name: string
  description: string
  start_url: string
  display: string
  background_color: string
  theme_color: string
  orientation: string
  scope: string
  lang: string
  categories: string[]
  icons: Array<{
    src: string
    sizes: string
    type: string
    purpose?: string
  }>
}

/**
 * 生成动态 manifest
 * @param appConfig 应用配置
 * @returns DynamicManifest 对象
 */
export const generateDynamicManifest = (appConfig: AppConfig | null): DynamicManifest => {
  const appName = appConfig?.appName || 'Macanudo Socials'

  // PWA install icons must have real, local dimensions so browsers can cache
  // and validate them before the service worker or app config is available.
  const defaultIcons: DynamicManifest['icons'] = [
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
    name: `${appName} - Cigar World`,
    short_name: appName,
    description: 'Premium cigar club management platform',
    start_url: '/',
    display: 'standalone',
    background_color: '#1A1A1A',
    theme_color: '#D4AF37',
    orientation: 'portrait-primary',
    scope: '/',
    lang: 'zh-CN',
    categories: ['lifestyle', 'business', 'entertainment'],
    icons: defaultIcons
  }
}

/**
 * 创建动态 manifest blob URL
 * @param manifest Manifest 对象
 * @returns Blob URL
 */
export const createManifestBlobUrl = (manifest: DynamicManifest): string => {
  const manifestJson = JSON.stringify(manifest, null, 2)
  const blob = new Blob([manifestJson], { type: 'application/json' })
  return URL.createObjectURL(blob)
}

/**
 * 更新 manifest link
 * 方案A：使用静态 manifest URL，由 Service Worker 动态生成
 * @param manifestUrl Manifest URL（现在固定为 /manifest.json）
 */
export const updateManifestLink = (manifestUrl?: string): void => {
  // 查找现有的 manifest link
  let manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement

  if (!manifestLink) {
    // 如果不存在，创建新的 link 元素
    manifestLink = document.createElement('link')
    manifestLink.rel = 'manifest'
    document.head.appendChild(manifestLink)
  }

  // 方案A：始终使用静态 URL，由 Service Worker 拦截并动态生成
  manifestLink.href = '/manifest.json'
}

/**
 * 更新 favicon
 * @param iconUrl 图标 URL
 */
export const updateFavicon = (iconUrl: string): void => {
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]')
    .forEach(link => link.remove())

  const favicon = document.createElement('link')
  const pathname = new URL(iconUrl, window.location.href).pathname.toLowerCase()

  favicon.rel = 'icon'
  favicon.href = iconUrl

  if (pathname.endsWith('.svg')) favicon.type = 'image/svg+xml'
  else if (pathname.endsWith('.png')) favicon.type = 'image/png'
  else if (pathname.endsWith('.webp')) favicon.type = 'image/webp'
  else if (pathname.endsWith('.ico')) favicon.type = 'image/x-icon'

  document.head.appendChild(favicon)
}

/**
 * 更新 Apple Touch Icons
 * @param iconUrl 图标 URL
 */
export const updateAppleTouchIcons = (iconUrl: string): void => {
  const sizes = ['180x180']

  sizes.forEach(size => {
    let appleIcon = document.querySelector(
      `link[rel="apple-touch-icon"][sizes="${size}"]`
    ) as HTMLLinkElement

    if (!appleIcon) {
      appleIcon = document.createElement('link')
      appleIcon.rel = 'apple-touch-icon'
      appleIcon.setAttribute('sizes', size)
      document.head.appendChild(appleIcon)
    }

    appleIcon.href = iconUrl
  })
}

/**
 * 应用动态图标更新
 * 方案A：manifest 由 Service Worker 动态生成，这里只更新 favicon 和 apple-touch-icon
 * @param appConfig 应用配置
 * @returns 清理函数（现在不需要清理，因为不使用 blob URL）
 */
export const applyDynamicIcons = (appConfig: AppConfig | null): (() => void) => {
  // 方案A：manifest 由 Service Worker 拦截 /manifest.json 请求并动态生成
  // 这里只更新 manifest link 为静态 URL
  updateManifestLink('/manifest.json')

  // The browser tab can follow the remote app logo, while installed icons use
  // the square, locally generated brand assets declared in the manifest.
  if (appConfig?.logoUrl) {
    updateFavicon(appConfig.logoUrl)
  }
  updateAppleTouchIcons('/icons/apple-touch-icon-180.png')

  // 返回空的清理函数（不再需要清理 blob URL）
  return () => {
    // 无需清理
  }
}
