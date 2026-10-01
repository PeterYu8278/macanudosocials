import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ signIn: vi.fn(), fetch: vi.fn() }))
vi.mock('firebase/auth', () => ({ signInWithCustomToken: mocks.signIn }))
vi.mock('../../config/firebase', () => ({ auth: { app: 'test' } }))
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }))
import { loginPhoneWithPassword } from './phoneLogin'

describe('loginPhoneWithPassword', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', mocks.fetch) })
  afterEach(() => vi.unstubAllGlobals())

  it('establishes the SDK session using only the verified backend token', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, customToken: 'token' }) })
    mocks.signIn.mockResolvedValue({ user: { uid: 'member' } })
    expect(await loginPhoneWithPassword('+60123456789', 'password')).toMatchObject({ success: true, user: { uid: 'member' } })
    expect(mocks.signIn).toHaveBeenCalledWith({ app: 'test' }, 'token')
    expect(mocks.fetch.mock.calls[0][0]).toBe('/.netlify/functions/phone-login')
  })

  it('does not sign in on invalid credentials or throttling', async () => {
    for (const code of ['auth/invalid-credential', 'auth/too-many-requests']) {
      mocks.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ success: false, code }) })
      expect(await loginPhoneWithPassword('+60123456789', 'wrong')).toMatchObject({ success: false, code })
    }
    expect(mocks.signIn).not.toHaveBeenCalled()
  })

  it('handles an unavailable local function server without leaking raw errors', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('proxy connection refused'))
    expect(await loginPhoneWithPassword('+60123456789', 'password')).toMatchObject({ success: false, code: 'auth/service-unavailable' })
    expect(mocks.signIn).not.toHaveBeenCalled()
  })
})
