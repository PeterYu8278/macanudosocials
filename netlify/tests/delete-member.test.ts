// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ verify: vi.fn(), getUser: vi.fn(), getEmail: vi.fn(), remove: vi.fn(),
  read: vi.fn(), query: vi.fn(), update: vi.fn(), deleteDoc: vi.fn(), audit: vi.fn(), commit: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], cert: vi.fn(), initializeApp: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: m.verify, getUser: m.getUser,
  getUserByEmail: m.getEmail, deleteUser: m.remove }) }))
vi.mock('../functions/_shared/memberIdentityLock', () => ({ lockMemberIdentity: async () => async () => {} }))
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: () => 'now' }, getFirestore: () => ({
  collection: () => ({ doc: (id = 'audit') => ({ id, get: () => m.read(id), update: m.update }),
    where: () => ({ limit: () => ({ get: m.query }) }) }),
  batch: () => ({ delete: m.deleteDoc, create: m.audit, commit: m.commit }),
}) }))
import { handler } from '../functions/delete-member'
const invoke = handler as unknown as (event: any) => Promise<{ statusCode: number }>
const request = (userId = 'member', headers: Record<string, string> = { authorization: 'Bearer token' }) =>
  invoke({ httpMethod: 'POST', headers, body: JSON.stringify({ userId }) })

describe('member account deletion', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.verify.mockResolvedValue({ uid: 'operator' })
    m.read.mockImplementation(async id => ({ exists: ['operator', 'member'].includes(id),
      data: () => id === 'operator' ? { role: 'developer' } : id === 'member'
        ? { role: 'member', authUid: 'member', email: 'member@example.com' } : undefined }))
    m.getUser.mockResolvedValue({ uid: 'member' })
    m.query.mockResolvedValue({ docs: [] })
  })
  it('deletes the linked login then the profile and records an audit', async () => {
    expect((await request()).statusCode).toBe(200)
    expect(m.remove).toHaveBeenCalledWith('member')
    expect(m.deleteDoc).toHaveBeenCalledWith(expect.objectContaining({ id: 'member' }))
    expect(m.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'delete-member', operatorId: 'operator' }))
    expect(m.remove.mock.invocationCallOrder[0]).toBeLessThan(m.commit.mock.invocationCallOrder[0])
  })
  it('rejects unauthenticated and ordinary admin callers before deletion', async () => {
    expect((await request('member', {})).statusCode).toBe(401)
    m.read.mockResolvedValue({ data: () => ({ role: 'admin' }) })
    expect((await request()).statusCode).toBe(403)
    expect(m.remove).not.toHaveBeenCalled()
  })
  it('accepts superAdmin callers for member accounts', async () => {
    const original = m.read.getMockImplementation()!
    m.read.mockImplementation(async id => id === 'operator' ? { data: () => ({ role: 'superAdmin' }) } : original(id))
    expect((await request()).statusCode).toBe(200)
  })
  it('blocks self deletion and equal role targets', async () => {
    expect((await request('operator')).statusCode).toBe(403)
    const original = m.read.getMockImplementation()!
    m.read.mockImplementation(async id => id === 'member' ? { exists: true, data: () => ({ role: 'developer', authUid: 'member' }) } : original(id))
    expect((await request()).statusCode).toBe(403)
    expect(m.remove).not.toHaveBeenCalled()
  })
  it('keeps the profile when Authentication deletion fails', async () => {
    m.remove.mockRejectedValue(new Error('unavailable'))
    expect((await request()).statusCode).toBe(503)
    expect(m.commit).not.toHaveBeenCalled()
  })
  it('can retry after Authentication was deleted but profile commit failed', async () => {
    m.commit.mockRejectedValueOnce(new Error('unavailable'))
    expect((await request()).statusCode).toBe(503)
    m.getUser.mockRejectedValue({ code: 'auth/user-not-found' })
    m.remove.mockRejectedValue({ code: 'auth/user-not-found' })
    expect((await request()).statusCode).toBe(200)
  })
  it('resolves and pins a legacy email mapping before deleting its login', async () => {
    const original = m.read.getMockImplementation()!
    m.read.mockImplementation(async id => id === 'member' ? { exists: true, data: () => ({ role: 'member', email: 'member@example.com' }) } : original(id))
    m.getUser.mockRejectedValue({ code: 'auth/user-not-found' })
    m.getEmail.mockResolvedValue({ uid: 'legacy-login' })
    expect((await request()).statusCode).toBe(200)
    expect(m.update).toHaveBeenCalledWith({ authUid: 'legacy-login' })
    expect(m.remove).toHaveBeenCalledWith('legacy-login')
  })
  it('rejects ambiguous mappings without deleting either record', async () => {
    m.query.mockResolvedValue({ docs: [{ id: 'other-member' }] })
    expect((await request()).statusCode).toBe(409)
    expect(m.remove).not.toHaveBeenCalled()
    expect(m.commit).not.toHaveBeenCalled()
  })
  it('rejects malformed identifiers and revoked tokens', async () => {
    expect((await request('users/member')).statusCode).toBe(400)
    m.verify.mockRejectedValue(new Error('revoked'))
    expect((await request()).statusCode).toBe(401)
    expect(m.remove).not.toHaveBeenCalled()
  })
})
