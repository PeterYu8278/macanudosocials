import { memoryCache } from './cache'

const runtimeCacheNames = new Set(['images', 'google-fonts-stylesheets', 'static-resources'])

export async function clearApplicationCache(): Promise<void> {
  memoryCache.clear()
  if (typeof caches === 'undefined') return

  // Preserve precached offline files and storage belonging to authentication or push.
  const names = (await caches.keys()).filter(name => runtimeCacheNames.has(name))
  const results = await Promise.allSettled(names.map(name => caches.delete(name)))
  if (results.some(result => result.status === 'rejected')) {
    throw new Error('Unable to clear all application caches')
  }
}
