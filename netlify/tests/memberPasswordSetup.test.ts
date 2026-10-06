// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ read: vi.fn(), link: vi.fn(), fetch: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ generatePasswordResetLink: m.link }) }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collection: () => ({ doc: () => ({ get: m.read }) }) }) }))
import { sendMemberPasswordSetup } from '../functions/_shared/memberPasswordSetup'

describe('member password setup delivery', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', m.fetch)
    vi.stubEnv('FIREBASE_WEB_API_KEY', 'web-key')
    vi.stubEnv('VITE_FIREBASE_API_KEY', '')
    vi.stubEnv('RESEND_API_KEY', 'resend-key')
    vi.stubEnv('MEMBER_EMAIL_FROM', 'Members <members@example.com>')
    m.read.mockResolvedValue({ data: () => ({}) })
    m.fetch.mockResolvedValue({ ok: true })
    m.link.mockResolvedValue('https://example.com/reset?oobCode=private-code')
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
  it('uses Firebase when no provider is selected', async () => {
    expect(await sendMemberPasswordSetup('member@example.com')).toBe('sent')
    expect(m.fetch).toHaveBeenCalledWith(expect.stringContaining('accounts:sendOobCode?key=web-key'), expect.objectContaining({
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: 'member@example.com' }),
    }))
    expect(m.link).not.toHaveBeenCalled()
  })
  it('uses Resend with a Firebase reset link when selected', async () => {
    m.read.mockResolvedValue({ data: () => ({ emailProviders: { passwordReset: 'resend' } }) })
    expect(await sendMemberPasswordSetup('member@example.com')).toBe('sent')
    expect(m.link).toHaveBeenCalledWith('member@example.com')
    const payload = JSON.parse(m.fetch.mock.calls[0][1].body)
    expect(payload.to).toEqual(['member@example.com'])
    expect(payload.text).toContain('private-code')
    expect(payload).not.toHaveProperty('password')
  })
  it('reports missing configuration without attempting delivery', async () => {
    vi.stubEnv('FIREBASE_WEB_API_KEY', '')
    expect(await sendMemberPasswordSetup('member@example.com')).toBe('failed')
    expect(m.fetch).not.toHaveBeenCalled()
  })
  it('reports provider rejection and network failures without throwing', async () => {
    m.fetch.mockResolvedValue({ ok: false })
    expect(await sendMemberPasswordSetup('member@example.com')).toBe('failed')
    m.fetch.mockRejectedValue(new Error('timeout'))
    expect(await sendMemberPasswordSetup('member@example.com')).toBe('failed')
  })
  it('does not silently fall back when config cannot be read', async () => {
    m.read.mockRejectedValue(new Error('unavailable'))
    expect(await sendMemberPasswordSetup('member@example.com')).toBe('failed')
    expect(m.fetch).not.toHaveBeenCalled()
  })
})
