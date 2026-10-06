// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ verify: vi.fn(), create: vi.fn(), remove: vi.fn(), getUser: vi.fn(), getEmail: vi.fn(),
  setupEmail: vi.fn(), updateAuth: vi.fn(), read: vi.fn(), query: vi.fn(), createDoc: vi.fn(), updateDoc: vi.fn(), transaction: vi.fn() }))
vi.mock('../functions/_shared/memberPasswordSetup', () => ({ sendMemberPasswordSetup: m.setupEmail }))
vi.mock('../functions/_shared/memberIdentityLock', () => ({ lockMemberIdentity: async () => async () => {}, assertUniqueMemberIdentity: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], cert: vi.fn(), initializeApp: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: m.verify, createUser: m.create,
  deleteUser: m.remove, getUser: m.getUser, getUserByEmail: m.getEmail, updateUser: m.updateAuth }) }))
vi.mock('firebase-admin/firestore', () => {
  const query = { limit: () => query, get: m.query }
  return { Timestamp: { now: () => 'now' }, getFirestore: () => ({
    collection: () => ({ doc: (id = 'audit') => ({ id, get: () => m.read(id), update: m.updateDoc }), where: () => query }),
    runTransaction: m.transaction,
  }) }
})
import { eventHandler as handler } from '../functions/create-member'
const invoke = handler as unknown as (event: any) => Promise<{ statusCode: number; body: string }>
const input = { displayName: 'Member', email: 'MEMBER@example.com', phone: '+60123456789', password: 'secret123', role: 'member', level: 'bronze' }
const request = (body: any = input, headers = { authorization: 'Bearer token' }) => invoke({ httpMethod: 'POST', body: JSON.stringify(body), headers })
describe('manual member account creation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.setupEmail.mockResolvedValue('sent')
    m.verify.mockResolvedValue({ uid: 'operator' })
    m.read.mockImplementation(async id => ({ exists: id === 'operator' || id === 'legacy',
      data: () => id === 'operator' ? { role: 'developer' } : id === 'legacy' ? { role: 'member', email: input.email.toLowerCase(), profile: { phone: input.phone } } : undefined }))
    m.query.mockResolvedValue({ empty: true, docs: [] })
    m.create.mockImplementation(async data => ({ uid: data.uid || 'new-uid' }))
    m.getUser.mockRejectedValue({ code: 'auth/user-not-found' })
    m.getEmail.mockRejectedValue({ code: 'auth/user-not-found' })
    m.transaction.mockImplementation(async cb => cb({ get: async ref => ref.id ? m.read(ref.id) : { empty: true }, create: m.createDoc, update: m.updateDoc }))
  })
  it('creates Auth and the matching profile without storing passwords', async () => {
    expect((await request()).statusCode).toBe(200)
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'member@example.com', phoneNumber: input.phone, password: expect.any(String) }))
    const password = m.create.mock.calls[0][0].password
    expect(password.length).toBeGreaterThanOrEqual(32)
    expect(password).not.toBe(input.password)
    expect(m.setupEmail).toHaveBeenCalledWith('member@example.com')
    const profile = m.createDoc.mock.calls[0]
    expect(profile[0].id).toBe('new-uid')
    expect(profile[1]).toMatchObject({ authUid: 'new-uid', role: 'member', profile: { phone: input.phone } })
    expect(JSON.stringify(m.createDoc.mock.calls)).not.toContain(input.password)
    expect(JSON.stringify(m.createDoc.mock.calls)).not.toContain(password)
  })
  it('rejects unauthorized operators and role escalation', async () => {
    expect((await request(input, {} as any)).statusCode).toBe(401)
    expect((await request({ ...input, role: 'developer' })).statusCode).toBe(403)
    m.read.mockResolvedValue({ data: () => ({ role: 'member' }) })
    expect((await request()).statusCode).toBe(403)
    expect(m.create).not.toHaveBeenCalled()
  })
  it('rejects duplicates in legacy profiles or Auth', async () => {
    m.query.mockResolvedValue({ empty: false, docs: [{ id: 'other' }] })
    expect((await request()).statusCode).toBe(409)
    expect(m.create).not.toHaveBeenCalled()
    m.query.mockResolvedValue({ empty: true, docs: [] })
    m.create.mockRejectedValue({ code: 'auth/phone-number-already-exists' })
    expect(JSON.parse((await request()).body).code).toBe('phone-in-use')
  })
  it('rolls back a new Auth account when profile creation fails', async () => {
    m.transaction.mockRejectedValue(new Error('write failed'))
    expect((await request()).statusCode).toBe(503)
    expect(m.remove).toHaveBeenCalledWith('new-uid')
    expect(m.setupEmail).not.toHaveBeenCalled()
  })
  it('does not delete Auth if a timed-out commit actually saved the profile', async () => {
    m.transaction.mockRejectedValue(new Error('timeout'))
    m.read.mockImplementation(async id => ({ exists: true, data: () => id === 'operator' ? { role: 'developer' } : { authUid: id } }))
    await request()
    expect(m.remove).not.toHaveBeenCalled()
  })
  it('backfills a legacy account with a random password and keeps its UID', async () => {
    expect((await request({ userId: 'legacy' })).statusCode).toBe(200)
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ uid: 'legacy' }))
    expect(m.setupEmail).toHaveBeenCalledWith('member@example.com')
    expect(m.updateDoc.mock.calls[0][0].id).toBe('legacy')
  })
  it('creates without an input password and generates different passwords per account', async () => {
    const { password: _password, ...body } = input
    expect((await request(body)).statusCode).toBe(200)
    expect((await request(body)).statusCode).toBe(200)
    expect(m.create.mock.calls[0][0].password).not.toBe(m.create.mock.calls[1][0].password)
  })
  it('preserves the created account and reports delivery failure', async () => {
    m.setupEmail.mockResolvedValue('failed')
    const response = await request()
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body).passwordSetupEmail).toBe('failed')
    expect(m.remove).not.toHaveBeenCalled()
  })
  it('saving an existing Auth account never changes its password or creates another account', async () => {
    m.getUser.mockResolvedValue({ uid: 'legacy', email: 'member@example.com', phoneNumber: input.phone })
    expect(JSON.parse((await request({ userId: 'legacy', password: 'another123' })).body).code).toBe('account-exists')
    expect(m.create).not.toHaveBeenCalled()
    expect(m.updateDoc).toHaveBeenCalledWith(expect.objectContaining({ email: 'member@example.com', 'profile.phone': input.phone }))
    expect(m.updateAuth).not.toHaveBeenCalled()
    expect(m.setupEmail).not.toHaveBeenCalled()
  })
  it('uses corrected contact details to backfill and preserves existing membership data', async () => {
    const response = await request({ userId: 'legacy', password: input.password, email: 'correct@example.com', phone: '+60129876543' })
    expect(response.statusCode).toBe(200)
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ uid: 'legacy', email: 'correct@example.com', phoneNumber: '+60129876543' }))
    const update = m.updateDoc.mock.calls[0][1]
    expect(update.email).toBe('correct@example.com')
    expect(update['profile.phone']).toBe('+60129876543')
    expect(update).not.toHaveProperty('membership')
    expect(update).not.toHaveProperty('points')
  })
  it('rolls back Auth when a legacy profile update fails', async () => {
    m.transaction.mockRejectedValue(new Error('write failed'))
    expect((await request({ userId: 'legacy', password: input.password })).statusCode).toBe(503)
    expect(m.remove).toHaveBeenCalledWith('legacy')
  })
  it('refuses to link a legacy profile to an unrelated email account', async () => {
    m.getEmail.mockResolvedValue({ uid: 'different' })
    expect(JSON.parse((await request({ userId: 'legacy', password: input.password })).body).code).toBe('identity-conflict')
    expect(m.create).not.toHaveBeenCalled()
  })
  it('repairs a missing Auth phone when saving unchanged legacy contact details', async () => {
    m.getUser.mockResolvedValue({ uid: 'legacy', email: 'member@example.com', emailVerified: true })
    expect((await request({ userId: 'legacy' })).statusCode).toBe(200)
    expect(m.updateAuth).toHaveBeenCalledWith('legacy', { phoneNumber: input.phone })
    expect(m.updateDoc).toHaveBeenCalledWith(expect.objectContaining({ email: 'member@example.com', 'profile.phone': input.phone }))
  })
  it('reconciles stale Firestore contact details against Auth without changing Auth', async () => {
    m.getUser.mockResolvedValue({ uid: 'legacy', email: 'canonical@example.com', phoneNumber: '+60129876543', emailVerified: true })
    expect((await request({ userId: 'legacy' })).statusCode).toBe(200)
    expect(m.updateAuth).not.toHaveBeenCalled()
    expect(m.updateDoc).toHaveBeenCalledWith(expect.objectContaining({ email: 'canonical@example.com', 'profile.phone': '+60129876543' }))
  })
})
