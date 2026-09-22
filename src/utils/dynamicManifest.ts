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
  const appName = appConfig?.appName || 'Cigar Club'
  const logoUrl = appConfig?.logoUrl

  // 基础图标配置（使用默认图标）
  const defaultIcons = [
    {
      src: '/icons/icon-72x72.svg',
      sizes: '72x72',
      type: 'image/svg+xml'
    },
    {
      src: '/icons/icon-96x96.svg',
      sizes: '96x96',
      type: 'image/svg+xml'
    },
    {
      src: '/icons/icon-128x128.svg',
      sizes: '128x128',
      type: 'image/svg+xml'
    },
    {
      src: '/icons/icon-144x144.svg',
      sizes: '144x144',
      type: 'image/svg+xml'
    },
    {
      src: '/icons/icon-152x152.svg',
      sizes: '152x152',
      type: 'image/svg+xml'
    },
    {
      src: '/icons/icon-192x192.svg',
      sizes: '192x192',
      type: 'image/svg+xml',
      purpose: 'any maskable'
    },
    {
      src: '/icons/icon-384x384.svg',
      sizes: '384x384',
      type: 'image/svg+xml'
    },
    {
      src: '/icons/icon-512x512.svg',
      sizes: '512x512',
      type: 'image/svg+xml',
      purpose: 'any maskable'
    }
  ]

  // 如果有自定义 logo，优先使用自定义 logo
  const icons = logoUrl
    ? (() => {
        // 检测图标类型（根据 URL 扩展名）
        const isSvg = logoUrl.toLowerCase().endsWith('.svg')
        const iconType = isSvg ? 'image/svg+xml' : 'image/png'
        
        return [
          // 使用自定义 logo 作为主要图标
          {
            src: logoUrl,
            sizes: '192x192',
            type: iconType,
            purpose: 'any maskable'
          },
          {
            src: logoUrl,
            sizes: '512x512',
            type: iconType,
            purpose: 'any maskable'
          },
          // 保留其他尺寸的默认图标作为降级
          ...defaultIcons.filter(icon => !['192x192', '512x512'].includes(icon.sizes))
        ]
      })()
    : defaultIcons

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
    icons
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
  const sizes = ['180x180', '152x152', '144x144', '120x120']

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

  // 如果有自定义 logo，更新图标
  if (appConfig?.logoUrl) {
    updateFavicon(appConfig.logoUrl)
    updateAppleTouchIcons(appConfig.logoUrl)
  }

  // 返回空的清理函数（不再需要清理 blob URL）
  return () => {
    // 无需清理
  }
}
