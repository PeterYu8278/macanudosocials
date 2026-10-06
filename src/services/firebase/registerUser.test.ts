// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ signIn: vi.fn(), fetch: vi.fn() }))
vi.mock('../../config/firebase', () => ({ auth: 'auth' }))
vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword: m.signIn }))
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }))
import { registerUser } from './registerMember'
describe('server-backed registration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', m.fetch)
    m.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    m.signIn.mockResolvedValue({ user: { uid: 'new-member' } })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('normalizes contacts and signs in only after the backend commits both identities', async () => {
    expect((await registerUser(' Member@Example.com ', 'password123', 'Member', '0123456789', 'REF123')).success).toBe(true)
    expect(m.fetch.mock.calls[0][0]).toBe('/.netlify/functions/register-member')
    expect(JSON.parse(m.fetch.mock.calls[0][1].body)).toMatchObject({ email: 'member@example.com', phone: '+60123456789', referralCode: 'REF123' })
    expect(m.signIn).toHaveBeenCalledWith('auth', 'member@example.com', 'password123')
  })
  it.each(['email-in-use', 'phone-in-use', 'invalid-referral-code'])('does not sign in when backend rejects %s', async code => {
    m.fetch.mockResolvedValue({ ok: false, json: async () => ({ success: false, code }) })
    expect(await registerUser('member@example.com', 'password123', 'Member', '0123456789')).toMatchObject({ success: false, code })
    expect(m.signIn).not.toHaveBeenCalled()
  })
  it('explains that the account exists if automatic sign-in fails', async () => {
    m.signIn.mockRejectedValue(new Error('network'))
    expect(await registerUser('member@example.com', 'password123', 'Member', '0123456789')).toMatchObject({ success: false, code: 'registration-login-required' })
  })
  it('does not claim failure to create when the registration response is lost', async () => {
    m.fetch.mockRejectedValue(new Error('timeout'))
    expect(await registerUser('member@example.com', 'password123', 'Member', '0123456789')).toMatchObject({ success: false, code: 'registration-recovery-required' })
  })
  it('rejects invalid phone input before calling the backend', async () => {
    expect((await registerUser('member@example.com', 'password123', 'Member', '123')).success).toBe(false)
    expect(m.fetch).not.toHaveBeenCalled()
  })
})
