// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ config: vi.fn(), rateGet: vi.fn(), rateSet: vi.fn(), link: vi.fn(), send: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ generatePasswordResetLink: mocks.link }) }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({
  collection: (name: string) => ({ doc: (id: string) => ({ id, get: name === 'app_config' ? mocks.config : undefined }) }),
  runTransaction: async (callback: (transaction: unknown) => Promise<boolean>) => callback({ get: mocks.rateGet, set: mocks.rateSet }),
}) }))
import { eventHandler as handler } from '../functions/email-password-reset'
const invoke = handler as unknown as (event: { httpMethod: string; body: string; headers: Record<string, string> }) => Promise<{ statusCode: number; body: string }>
const request = (email: unknown = ' Member@Example.com ') => invoke({ httpMethod: 'POST', headers: { 'x-nf-client-connection-ip': '127.0.0.1' }, body: JSON.stringify({ email }) })

describe('Resend password reset', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('MEMBER_EMAIL_FROM', 'test@example.com')
    vi.stubGlobal('fetch', mocks.send)
    mocks.config.mockResolvedValue({ data: () => ({ emailProviders: { passwordReset: 'resend' } }) })
    mocks.rateGet.mockResolvedValue({ data: () => undefined })
    mocks.link.mockResolvedValue('https://example.com/firebase-reset?oobCode=secret')
    mocks.send.mockResolvedValue({ ok: true })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  it('sends a Firebase-generated action link through Resend without returning it', async () => {
    const response = await request()
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('{"success":true}')
    expect(mocks.link).toHaveBeenCalledWith('member@example.com')
    expect(mocks.send.mock.calls[0][0]).toBe('https://api.resend.com/emails')
    expect(JSON.parse(mocks.send.mock.calls[0][1].body)).toMatchObject({ to: ['member@example.com'], text: expect.stringContaining('oobCode=secret') })
    expect(mocks.rateSet).toHaveBeenCalledTimes(2)
  })
  it('does not disclose whether the account exists', async () => {
    mocks.link.mockRejectedValue({ code: 'auth/user-not-found' })
    expect((await request()).body).toBe('{"success":true}')
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('rejects unsupported methods and invalid inputs before accessing providers', async () => {
    expect((await invoke({ httpMethod: 'GET', headers: {}, body: '' })).statusCode).toBe(405)
    for (const email of ['bad', null, 'x'.repeat(255)]) expect((await request(email)).statusCode).toBe(400)
    expect(mocks.link).not.toHaveBeenCalled()
  })
  it('enforces backend rate limits', async () => {
    mocks.rateGet.mockResolvedValue({ data: () => ({ startedAt: Date.now(), count: 5 }) })
    expect((await request()).statusCode).toBe(429)
    expect(mocks.link).not.toHaveBeenCalled()
  })
  it('refuses a client request when Resend is not the configured provider', async () => {
    mocks.config.mockResolvedValue({ data: () => ({ emailProviders: { passwordReset: 'firebase' } }) })
    expect((await request()).statusCode).toBe(409)
    expect(mocks.link).not.toHaveBeenCalled()
  })
  it('fails closed when provider secrets or delivery are unavailable', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    expect((await request()).statusCode).toBe(503)
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    mocks.send.mockResolvedValue({ ok: false })
    expect((await request()).statusCode).toBe(503)
  })
})
