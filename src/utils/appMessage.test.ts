import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessageInstance } from 'antd/es/message/interface'
import { getAppMessage, registerAppMessage } from './appMessage'
import { apiCall } from '../services/api/base'

afterEach(() => vi.useRealTimers())

describe('application message context', () => {
  it('does not clear a newer context when an older bridge unmounts', () => {
    const first = {} as MessageInstance
    const second = {} as MessageInstance
    const cleanupFirst = registerAppMessage(first)
    const cleanupSecond = registerAppMessage(second)
    cleanupFirst()
    expect(getAppMessage()).toBe(second)
    cleanupSecond()
    expect(getAppMessage()).toBeUndefined()
  })

  it('routes API notifications through the registered App instance', async () => {
    vi.useFakeTimers()
    const hide = vi.fn()
    const message = { loading: vi.fn(() => hide), success: vi.fn(), error: vi.fn() } as unknown as MessageInstance
    const cleanup = registerAppMessage(message)
    try {
      expect(await apiCall(async () => 42, { showLoading: true, showSuccess: true, successMessage: 'Saved' })).toMatchObject({ success: true, data: 42 })
      expect(message.loading).toHaveBeenCalled()
      expect(hide).toHaveBeenCalled()
      expect(message.success).toHaveBeenCalledWith('Saved')
      expect(await apiCall(async () => { throw new Error('Failed') }, { retryTimes: 0 })).toMatchObject({ success: false })
      expect(message.error).toHaveBeenCalledWith('Failed')
    } finally {
      cleanup()
      vi.clearAllTimers()
    }
  })

  it('allows API calls without a mounted message bridge', async () => {
    vi.useFakeTimers()
    expect(getAppMessage()).toBeUndefined()
    expect(await apiCall(async () => 42, { showLoading: true, showSuccess: true })).toMatchObject({ success: true, data: 42 })
    vi.clearAllTimers()
  })
})
