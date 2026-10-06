// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ verify: vi.fn(), account: vi.fn(), documents: new Map<string, any>(), create: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], cert: vi.fn(), initializeApp: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: m.verify, getUser: m.account }) }))
vi.mock('../functions/_shared/memberIdentityLock', async original => ({ ...await original<typeof import('../functions/_shared/memberIdentityLock')>(), lockMemberIdentity: async () => async () => {} }))
vi.mock('firebase-admin/firestore', () => {
  const ref = (id: string) => ({ id, get: async () => ({ exists: m.documents.has(id), data: () => m.documents.get(id) }) })
  const query = (key: string, value: unknown) => ({ limit: () => ({ get: async () => {
    const docs = [...m.documents].filter(([, data]) => key.split('.').reduce((data, field) => data?.[field], data) === value).map(([id]) => ref(id))
    return { docs, empty: docs.length === 0 }
  } }) })
  return { Timestamp: { now: () => 'now' }, getFirestore: () => ({
    collection: () => ({ doc: ref, where: (key: string, _op: string, value: unknown) => query(key, value) }),
    runTransaction: async (callback: any) => callback({ get: (ref: any) => ref.get(), create: m.create }),
  }) }
})
import { eventHandler as handler } from '../functions/ensure-member-profile'
const invoke = handler as unknown as (event: any) => Promise<{ statusCode: number; body: string }>
const request = () => invoke({ httpMethod: 'POST', headers: { authorization: 'Bearer token' } })
describe('trusted profile bootstrap', () => {
  beforeEach(() => {
    vi.resetAllMocks(); m.documents.clear()
    m.verify.mockResolvedValue({ uid: 'member' })
    m.account.mockResolvedValue({ uid: 'member', email: 'member@example.com', displayName: 'Member', emailVerified: true, phoneNumber: '+60123456789' })
  })
  it('creates a least-privilege profile using only actual Auth contact details', async () => {
    expect((await request()).statusCode).toBe(200)
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'member' }), expect.objectContaining({
      authUid: 'member', email: 'member@example.com', profile: expect.objectContaining({ phone: '+60123456789' }), role: 'guest', membership: expect.objectContaining({ points: 0 }),
    }))
  })
  it('rejects a legacy duplicate email instead of creating another membership', async () => {
    m.documents.set('legacy', { email: 'member@example.com' })
    expect(JSON.parse((await request()).body).code).toBe('email-in-use')
    expect(m.create).not.toHaveBeenCalled()
  })
  it('does not overwrite established membership data', async () => {
    m.documents.set('member', { role: 'vip', membership: { points: 100 } })
    expect((await request()).statusCode).toBe(200)
    expect(m.create).not.toHaveBeenCalled()
  })
  it('reuses a trusted legacy mapping', async () => {
    m.documents.set('legacy', { authUid: 'member', email: 'member@example.com' })
    expect(JSON.parse((await request()).body).userId).toBe('legacy')
    expect(m.create).not.toHaveBeenCalled()
  })
  it('requires authentication and rejects contacts that change while acquiring the lock', async () => {
    expect((await invoke({ httpMethod: 'POST', headers: {} })).statusCode).toBe(401)
    m.account.mockResolvedValueOnce({ uid: 'member', email: 'old@example.com' })
    expect(JSON.parse((await request()).body).code).toBe('change-busy')
    expect(m.create).not.toHaveBeenCalled()
  })
})
