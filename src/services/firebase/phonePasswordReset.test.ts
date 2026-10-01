import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }))
import { requestPhonePasswordReset } from './phonePasswordReset'

describe('requestPhonePasswordReset', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('requests recovery without a password, user lookup or returned recovery secret', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetch)
    expect(await requestPhonePasswordReset('+60123456789')).toEqual({ success: true })
    expect(fetch.mock.calls[0][0]).toBe('/.netlify/functions/phone-password-reset')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ phone: '+60123456789' })
  })
  it('localizes throttling and does not expose raw permission errors', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockRejectedValueOnce(new Error('Missing or insufficient permissions.'))
    vi.stubGlobal('fetch', fetch)
    expect(await requestPhonePasswordReset('phone')).toEqual({ success: false, error: 'auth.phoneResetTooManyRequests' })
    expect(await requestPhonePasswordReset('phone')).toEqual({ success: false, error: 'auth.phoneResetUnavailable' })
  })
})
