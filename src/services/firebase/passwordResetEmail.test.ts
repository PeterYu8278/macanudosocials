import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ config: vi.fn(), firebase: vi.fn(), fetch: vi.fn() }))
vi.mock('./appConfig', () => ({ getAppConfig: mocks.config }))
vi.mock('../../config/firebase', () => ({ auth: 'auth-instance' }))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: mocks.firebase }))
import { sendRecoveryEmail } from './passwordResetEmail'
describe('email recovery provider routing', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.config.mockResolvedValue({})
    mocks.firebase.mockResolvedValue(undefined)
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', mocks.fetch)
  })
  afterEach(() => vi.unstubAllGlobals())
  it('preserves Firebase as the default', async () => {
    expect(await sendRecoveryEmail('member@example.com')).toBe('firebase')
    expect(mocks.firebase).toHaveBeenCalledWith('auth-instance', 'member@example.com')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('uses the backend for Resend without exposing credentials', async () => {
    mocks.config.mockResolvedValue({ emailProviders: { passwordReset: 'resend' } })
    expect(await sendRecoveryEmail('member@example.com')).toBe('resend')
    expect(mocks.fetch.mock.calls[0][0]).toBe('/.netlify/functions/email-password-reset')
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ email: 'member@example.com' })
    expect(mocks.firebase).not.toHaveBeenCalled()
  })
  it('does not silently switch providers after a failed Resend request', async () => {
    mocks.config.mockResolvedValue({ emailProviders: { passwordReset: 'resend' } })
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ success: false, code: 'too-many-requests' }) })
    await expect(sendRecoveryEmail('member@example.com')).rejects.toThrow('too-many-requests')
    expect(mocks.firebase).not.toHaveBeenCalled()
  })
})
