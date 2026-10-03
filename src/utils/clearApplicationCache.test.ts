import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearApplicationCache } from './clearApplicationCache'

const clear = vi.hoisted(() => vi.fn())
vi.mock('./cache', () => ({ memoryCache: { clear } }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('clearApplicationCache', () => {
  it('clears runtime caches but preserves offline and third-party caches and login storage', async () => {
    const remove = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('caches', {
      keys: vi.fn().mockResolvedValue(['images', 'static-resources', 'google-fonts-stylesheets', 'workbox-precache-v2', 'onesignal']),
      delete: remove,
    })
    const clearStorage = vi.spyOn(Storage.prototype, 'clear')
    await clearApplicationCache()
    expect(clear).toHaveBeenCalledOnce()
    expect(remove.mock.calls.map(([name]) => name)).toEqual(['images', 'static-resources', 'google-fonts-stylesheets'])
    expect(clearStorage).not.toHaveBeenCalled()
    clearStorage.mockRestore()
  })

  it('works when CacheStorage is unavailable', async () => {
    vi.stubGlobal('caches', undefined)
    await expect(clearApplicationCache()).resolves.toBeUndefined()
    expect(clear).toHaveBeenCalledOnce()
  })

  it('reports failures after attempting all runtime cache deletions', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('caches', { keys: vi.fn().mockResolvedValue(['images', 'static-resources']), delete: remove })
    await expect(clearApplicationCache()).rejects.toThrow('Unable to clear all application caches')
    expect(remove).toHaveBeenCalledTimes(2)
  })
})
