import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ collection: vi.fn(), transaction: vi.fn(), link: vi.fn(), fetch: vi.fn(), verify: vi.fn(), update: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ generatePasswordResetLink: mocks.link, verifyIdToken: mocks.verify, updateUser: mocks.update }) }))
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collection: mocks.collection, runTransaction: mocks.transaction }) }))
import { handler } from '../netlify/functions/phone-password-reset'
import { handler as directReset } from '../netlify/functions/reset-password'
const call = (body: string, httpMethod = 'POST') => handler({ httpMethod, body, headers: {} } as any, {} as any, vi.fn()) as Promise<any>

describe('phone password recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.collection.mockImplementation(name => name === 'app_config'
      ? { doc: () => ({ get: async () => ({ data: () => ({ whapi: { enabled: true, apiToken: 'test-token' } }) }) }) }
      : { where: () => ({ limit: () => ({ get: async () => ({ docs: [{ data: () => ({ email: 'member@example.test' }) }] }) }) }) })
    mocks.transaction.mockResolvedValue(true)
    mocks.link.mockResolvedValue('https://example.test/reset?oobCode=secret')
    mocks.fetch.mockResolvedValue({ ok: true })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('validates method and input before accessing member records', async () => {
    expect((await call('{}', 'GET')).statusCode).toBe(405)
    expect((await call('{')).statusCode).toBe(400)
    expect((await call('{"phone":"bad"}')).statusCode).toBe(400)
    expect(mocks.collection).not.toHaveBeenCalled()
  })
  it('sends the recovery link only to the bound phone without changing a password or exposing the link', async () => {
    const response = await call('{"phone":"+60123456789","newPassword":"ignored","to":"attacker"}')
    expect(JSON.parse(response.body)).toEqual({ success: true })
    expect(mocks.link).toHaveBeenCalledWith('member@example.test')
    const message = JSON.parse(mocks.fetch.mock.calls[0][1].body)
    expect(message.to).toBe('60123456789')
    expect(message.body).toContain('oobCode=secret')
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('returns the same success response when no account is found', async () => {
    const original = mocks.collection.getMockImplementation()!
    mocks.collection.mockImplementation(name => name === 'users'
      ? { where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) }
      : original(name))
    expect(JSON.parse((await call('{"phone":"+60123456789"}')).body)).toEqual({ success: true })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('does not send messages when throttled and masks provider failures', async () => {
    mocks.transaction.mockResolvedValueOnce(false)
    expect((await call('{"phone":"+60123456789"}')).statusCode).toBe(429)
    expect(mocks.fetch).not.toHaveBeenCalled()
    mocks.fetch.mockRejectedValueOnce(new Error('secret-provider-error'))
    const response = await call('{"phone":"+60123456789"}')
    expect(response.statusCode).toBe(503)
    expect(response.body).not.toContain('secret-provider-error')
  })
  it('blocks unauthenticated direct password changes', async () => {
    const response: any = await directReset({ httpMethod: 'POST', headers: {}, body: '{"uid":"victim","newPassword":"password"}' } as any, {} as any, vi.fn())
    expect(response.statusCode).toBe(401)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('blocks non-administrator direct password changes', async () => {
    mocks.verify.mockResolvedValue({ uid: 'member' })
    mocks.collection.mockReturnValue({ doc: () => ({ get: async () => ({ data: () => ({ role: 'member' }) }) }) })
    const response: any = await directReset({ httpMethod: 'POST', headers: { authorization: 'Bearer test-token' }, body: '{}' } as any, {} as any, vi.fn())
    expect(response.statusCode).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
