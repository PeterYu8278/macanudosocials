// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ verify: vi.fn(), getUser: vi.fn(), getEmail: vi.fn(), updateAuth: vi.fn(), updateProfile: vi.fn(), duplicates: vi.fn(), documents: new Map<string, any>() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify, getUser: mocks.getUser, getUserByEmail: mocks.getEmail, updateUser: mocks.updateAuth }) }))
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: () => 'timestamp' }, getFirestore: () => ({ collection: () => ({
  doc: (id: string) => ({ get: async () => ({ data: () => mocks.documents.get(id) }), update: mocks.updateProfile }),
  where: () => ({ limit: () => ({ get: mocks.duplicates }) }),
}) }) }))
import { handler } from '../functions/update-member-phone'
const invoke = handler as unknown as (event: unknown) => Promise<{ statusCode: number; body: string }>
const save = (userId = 'member', phone = '0123456789') => invoke({ httpMethod: 'POST', headers: { authorization: 'Bearer test-token' }, body: JSON.stringify({ userId, phone }) })

describe('member phone synchronization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.documents.clear()
    mocks.documents.set('member', { role: 'member', email: 'member@example.com', profile: { phone: '+60111111111' } })
    mocks.verify.mockResolvedValue({ uid: 'member', auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' } })
    mocks.getUser.mockResolvedValue({ uid: 'member', email: 'member@example.com', phoneNumber: '+60111111111' })
    mocks.duplicates.mockResolvedValue({ docs: [] })
    mocks.updateAuth.mockResolvedValue({})
    mocks.updateProfile.mockResolvedValue({})
  })
  afterEach(() => vi.restoreAllMocks())

  it('updates Auth before the member profile after password verification', async () => {
    expect((await save()).statusCode).toBe(200)
    expect(mocks.verify).toHaveBeenCalledWith('test-token', true)
    expect(mocks.updateAuth).toHaveBeenCalledWith('member', { phoneNumber: '+60123456789' })
    expect(mocks.updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      'profile.phone': '+60123456789',
      'profile.phoneAuth': expect.objectContaining({ ownershipVerified: false, updatedBy: 'member', uid: 'member' }),
    }))
    expect(mocks.updateAuth.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateProfile.mock.invocationCallOrder[0])
  })

  it('accepts recent linked Google authentication', async () => {
    mocks.verify.mockResolvedValue({ uid: 'member', auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'google.com' } })
    expect((await save()).statusCode).toBe(200)
  })

  it.each(['expired', 'missing', 'custom'])('requires a recent allowed authentication method (%s)', async kind => {
    mocks.verify.mockResolvedValue({ uid: 'member', auth_time: kind === 'missing' ? undefined : Math.floor(Date.now() / 1000) - (kind === 'expired' ? 600 : 0), firebase: { sign_in_provider: kind === 'custom' ? 'custom' : 'password' } })
    expect((await save()).statusCode).toBe(401)
    expect(mocks.updateAuth).not.toHaveBeenCalled()
    expect(mocks.updateProfile).not.toHaveBeenCalled()
  })

  it('rejects editing another member without administrative permission', async () => {
    mocks.verify.mockResolvedValue({ uid: 'other', auth_time: Date.now() / 1000, firebase: { sign_in_provider: 'password' } })
    mocks.documents.set('other', { role: 'member' })
    expect((await save()).statusCode).toBe(403)
    expect(mocks.updateAuth).not.toHaveBeenCalled()
  })

  it('allows an admin to edit a member without changing the admin Auth account', async () => {
    mocks.verify.mockResolvedValue({ uid: 'operator', auth_time: Date.now() / 1000, firebase: { sign_in_provider: 'password' } })
    mocks.documents.set('operator', { role: 'admin' })
    expect((await save()).statusCode).toBe(200)
    expect(mocks.updateAuth).toHaveBeenCalledWith('member', { phoneNumber: '+60123456789' })
  })

  it.each(['admin', 'superAdmin', 'developer'])('does not let an admin modify a protected %s account', async role => {
    mocks.verify.mockResolvedValue({ uid: 'operator', auth_time: Date.now() / 1000, firebase: { sign_in_provider: 'password' } })
    mocks.documents.set('operator', { role: 'admin' })
    mocks.documents.set('member', { role, email: 'member@example.com' })
    expect((await save()).statusCode).toBe(403)
    expect(mocks.updateAuth).not.toHaveBeenCalled()
  })

  it('resolves a legacy profile using its stored email and checks the resulting UID', async () => {
    mocks.getUser.mockRejectedValueOnce({ code: 'auth/user-not-found' })
    mocks.getEmail.mockResolvedValue({ uid: 'member', email: 'member@example.com' })
    mocks.documents.set('legacy-profile', { role: 'member', email: 'member@example.com' })
    expect((await save('legacy-profile')).statusCode).toBe(200)
    expect(mocks.getEmail).toHaveBeenCalledWith('member@example.com')
    expect(mocks.updateAuth).toHaveBeenCalledWith('member', { phoneNumber: '+60123456789' })
  })

  it('checks the actual Auth account role when a legacy mapping targets a protected user', async () => {
    mocks.getUser.mockRejectedValueOnce({ code: 'auth/user-not-found' })
    mocks.getEmail.mockResolvedValue({ uid: 'protected' })
    mocks.documents.set('member', { role: 'guest', email: 'protected@example.com' })
    mocks.documents.set('protected', { role: 'developer' })
    mocks.documents.set('operator', { role: 'admin' })
    mocks.verify.mockResolvedValue({ uid: 'operator', auth_time: Date.now() / 1000, firebase: { sign_in_provider: 'password' } })
    expect((await save()).statusCode).toBe(403)
    expect(mocks.updateAuth).not.toHaveBeenCalled()
  })

  it('rejects a phone already in use in Firestore', async () => {
    mocks.duplicates.mockResolvedValue({ docs: [{ id: 'other' }] })
    expect((await save()).statusCode).toBe(409)
    expect(mocks.updateAuth).not.toHaveBeenCalled()
  })

  it('rejects an Auth phone conflict without writing the profile', async () => {
    mocks.updateAuth.mockRejectedValue({ code: 'auth/phone-number-already-exists' })
    expect((await save()).statusCode).toBe(409)
    expect(mocks.updateProfile).not.toHaveBeenCalled()
  })

  it('reports partial synchronization and repairs it without another Auth mutation on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.updateProfile.mockRejectedValueOnce({ code: 8 })
    const first = await save()
    expect(JSON.parse(first.body)).toMatchObject({ success: false, code: 'profile-sync-failed' })
    mocks.getUser.mockResolvedValue({ uid: 'member', phoneNumber: '+60123456789' })
    expect((await save()).statusCode).toBe(200)
    expect(mocks.updateAuth).toHaveBeenCalledTimes(1)
    expect(mocks.updateProfile).toHaveBeenCalledTimes(2)
  })

  it('does not silently create an Authentication account for a profile-only member', async () => {
    mocks.getUser.mockRejectedValueOnce({ code: 'auth/user-not-found' })
    mocks.getEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' })
    const response = await save()
    expect(response.statusCode).toBe(409)
    expect(JSON.parse(response.body).code).toBe('auth-account-missing')
    expect(mocks.updateAuth).not.toHaveBeenCalled()
  })

  it('rejects malformed phone and document IDs and unauthenticated requests', async () => {
    expect((await save('member', '123')).statusCode).toBe(400)
    expect((await save('users/member')).statusCode).toBe(400)
    expect((await invoke({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ userId: 'member', phone: '0123456789' }) })).statusCode).toBe(401)
    expect(mocks.updateAuth).not.toHaveBeenCalled()
  })
})
