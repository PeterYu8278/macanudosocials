// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), rateGet: vi.fn(), rateSet: vi.fn(), fetch: vi.fn(), verify: vi.fn(), token: vi.fn(), where: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify, createCustomToken: mocks.token }) }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({
  collection: (name: string) => name === 'users'
    ? { where: mocks.where }
    : { doc: (id: string) => ({ id }) },
  runTransaction: async (callback: (transaction: unknown) => Promise<boolean>) => callback({ get: mocks.rateGet, set: mocks.rateSet }),
}) }))
import { handler } from '../functions/phone-login'
const invoke = handler as unknown as (event: { httpMethod: string; body: string; headers: Record<string, string> }) => Promise<{ statusCode: number; body: string; headers: Record<string, string> }>
const login = (body: unknown = { phone: '0123456789', password: 'correct-password' }) => invoke({ httpMethod: 'POST', headers: { 'x-nf-client-connection-ip': '127.0.0.1' }, body: JSON.stringify(body) })

describe('phone-login backend', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-api-key')
    vi.stubEnv('FIREBASE_WEB_API_KEY', '')
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.rateGet.mockResolvedValue({ data: () => undefined })
    mocks.where.mockReturnValue({ limit: () => ({ get: mocks.lookup }) })
    mocks.lookup.mockResolvedValue({ docs: [{ data: () => ({ email: 'member@example.com' }) }] })
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ idToken: 'verified-id-token', localId: 'auth-uid' }) })
    mocks.verify.mockResolvedValue({ uid: 'auth-uid', email: 'member@example.com' })
    mocks.token.mockResolvedValue('custom-token')
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('verifies the password and token before issuing a session for the real Auth UID', async () => {
    const result = await login()
    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ success: true, customToken: 'custom-token' })
    expect(result.headers['Cache-Control']).toBe('no-store')
    expect(mocks.where).toHaveBeenCalledWith('profile.phone', '==', '+60123456789')
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ email: 'member@example.com', password: 'correct-password' })
    expect(mocks.verify).toHaveBeenCalledWith('verified-id-token', true)
    expect(mocks.token).toHaveBeenCalledWith('auth-uid')
  })

  it('returns the same generic failure for unknown phones and incorrect passwords', async () => {
    mocks.lookup.mockResolvedValueOnce({ docs: [] })
    const missing = await login()
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: 'INVALID_PASSWORD' } }) })
    const wrong = await login()
    expect(missing.statusCode).toBe(401)
    expect(wrong.body).toBe(missing.body)
    expect(mocks.token).not.toHaveBeenCalled()
    expect(wrong.body).not.toContain('member@example.com')
  })

  it('refuses ambiguous duplicate phones', async () => {
    mocks.lookup.mockResolvedValueOnce({ docs: [{}, {}] })
    expect((await login()).statusCode).toBe(401)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('never bypasses a pending second factor', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ mfaPendingCredential: 'pending' }) })
    expect((await login()).statusCode).toBe(401)
    expect(mocks.token).not.toHaveBeenCalled()
  })

  it('rejects a verified identity belonging to another account', async () => {
    mocks.verify.mockResolvedValueOnce({ uid: 'other-user', email: 'member@example.com' })
    expect((await login()).statusCode).toBe(401)
    expect(mocks.token).not.toHaveBeenCalled()
  })

  it('enforces distributed request limits before querying user profiles', async () => {
    mocks.rateGet.mockResolvedValue({ data: () => ({ count: 20, startedAt: Date.now() }) })
    const result = await login()
    expect(result.statusCode).toBe(429)
    expect(mocks.lookup).not.toHaveBeenCalled()
    expect(mocks.rateSet).not.toHaveBeenCalled()
  })

  it('reports unavailable configuration without exposing internals', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '')
    const result = await login()
    expect(result.statusCode).toBe(503)
    expect(JSON.parse(result.body)).toEqual({ success: false, code: 'auth/service-unavailable' })
  })

  it('rejects malformed inputs and unsupported methods', async () => {
    expect((await login(null)).statusCode).toBe(401)
    expect((await login({ phone: {}, password: 'test' })).statusCode).toBe(401)
    expect((await invoke({ httpMethod: 'GET', body: '', headers: {} })).statusCode).toBe(405)
    expect(mocks.lookup).not.toHaveBeenCalled()
  })
})
