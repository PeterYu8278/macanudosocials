// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ load: vi.fn(), send: vi.fn(), link: vi.fn(), query: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], cert: vi.fn(), initializeApp: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ generatePasswordResetLink: m.link }) }))
vi.mock('../functions/_shared/whatsapp', () => ({ loadWhatsApp: m.load, submitWhapi: m.send }))
vi.mock('firebase-admin/firestore', () => ({ initializeFirestore: () => ({
  collection: () => ({ doc: (id: string) => ({ id }), where: () => ({ limit: () => ({ get: m.query }) }) }),
  runTransaction: async (callback: any) => callback({ get: async () => ({ data: () => undefined }), set: vi.fn() }),
}) }))
import { handler } from '../functions/phone-password-reset'
const invoke = handler as unknown as (event: any) => Promise<{ statusCode: number; body: string }>
const request = () => invoke({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ phone: '0168008000' }) })
const loaded = () => ({ config: { enabled: true, defaultProvider: 'whapi', features: { passwordReset: true } }, token: 'secret-token', verified: true })
describe('phone recovery with managed WhatsApp channels', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.load.mockResolvedValue(loaded())
    m.query.mockResolvedValue({ docs: [{ data: () => ({ email: 'member@example.com' }) }] })
    m.link.mockResolvedValue('https://example.com/private-recovery-proof')
    m.send.mockResolvedValue({ status: 'accepted' })
  })
  it('uses the server provider without returning recovery links or credentials', async () => {
    const result = await request()
    expect(result.statusCode).toBe(200)
    expect(m.send).toHaveBeenCalledWith('secret-token', '+60168008000', expect.stringContaining('private-recovery-proof'))
    expect(result.body).not.toContain('private-recovery-proof')
    expect(result.body).not.toContain('secret-token')
  })
  it('blocks paused, unverified and disabled password recovery channels', async () => {
    for (const value of [{ ...loaded(), verified: false }, { ...loaded(), config: { ...loaded().config, enabled: false } },
      { ...loaded(), config: { ...loaded().config, features: { passwordReset: false } } }]) {
      m.load.mockResolvedValue(value)
      expect((await request()).statusCode).toBe(503)
    }
    expect(m.send).not.toHaveBeenCalled()
  })
  it('does not send through a different default provider', async () => {
    m.load.mockResolvedValue({ ...loaded(), config: { ...loaded().config, defaultProvider: 'manual' } })
    expect((await request()).statusCode).toBe(503)
    expect(m.link).not.toHaveBeenCalled()
  })
  it('preserves account privacy for missing or ambiguous members', async () => {
    for (const docs of [[], [{}, {}]]) {
      m.query.mockResolvedValue({ docs })
      expect((await request()).statusCode).toBe(200)
    }
    expect(m.send).not.toHaveBeenCalled()
  })
  it('does not report successful submission when the provider outcome is unknown', async () => {
    m.send.mockResolvedValue({ status: 'unknown' })
    expect((await request()).statusCode).toBe(503)
    expect(m.send).toHaveBeenCalledTimes(1)
  })
})
