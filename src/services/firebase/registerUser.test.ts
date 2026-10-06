// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ create: vi.fn(), profile: vi.fn(), write: vi.fn(), wait: vi.fn(), read: vi.fn(),
  sync: vi.fn(), memberId: vi.fn(), referrer: vi.fn(), update: vi.fn() }))
vi.mock('../../config/firebase', () => ({ auth: 'auth', db: 'db' }))
vi.mock('firebase/auth', async importOriginal => ({ ...await importOriginal<typeof import('firebase/auth')>(),
  createUserWithEmailAndPassword: m.create, updateProfile: m.profile }))
vi.mock('firebase/firestore', async importOriginal => ({ ...await importOriginal<typeof import('firebase/firestore')>(),
  doc: (...args: unknown[]) => args.join('/'), setDoc: m.write, waitForPendingWrites: m.wait,
  getDocFromServer: m.read, getDoc: m.read, updateDoc: m.update }))
vi.mock('../../utils/memberId', () => ({ generateMemberId: m.memberId, getUserByMemberId: m.referrer }))
vi.mock('./memberPhone', () => ({ updateMemberPhone: m.sync }))
vi.mock('./appConfig', () => ({ getAppConfig: vi.fn() }))
vi.mock('./passwordResetEmail', () => ({ sendRecoveryEmail: vi.fn() }))
vi.mock('./phoneLogin', () => ({ loginPhoneWithPassword: vi.fn() }))
vi.mock('../../i18n', () => ({ default: { t: (key: string, values?: { reason: string }) => `${key}:${values?.reason || ''}` } }))

import { registerUser } from './auth'

describe('registration phone synchronization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.create.mockResolvedValue({ user: { uid: 'new-member' } })
    m.memberId.mockResolvedValue('ABC123')
    m.read.mockResolvedValue({ exists: () => true, data: () => ({ referral: { referrals: [] } }) })
  })
  it('synchronizes the normalized phone before reporting success', async () => {
    const result = await registerUser(' Member@Example.com ', 'password123', 'Member', '0123456789')
    expect(result.success).toBe(true)
    expect(m.create).toHaveBeenCalledWith('auth', 'member@example.com', 'password123')
    expect(m.write).toHaveBeenCalledWith('db/users/new-member', expect.objectContaining({ profile: { phone: '+60123456789' } }))
    expect(m.sync).toHaveBeenCalledWith('new-member', '+60123456789')
    expect(m.read.mock.invocationCallOrder[0]).toBeLessThan(m.sync.mock.invocationCallOrder[0])
  })
  it('waits for the backend rather than reporting success while synchronization is pending', async () => {
    let finish: () => void = () => {}
    m.sync.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    let settled = false
    const registration = registerUser('member@example.com', 'password123', 'Member', '0123456789').then(result => { settled = true; return result })
    await vi.waitFor(() => expect(m.sync).toHaveBeenCalled())
    expect(settled).toBe(false)
    finish()
    expect((await registration).success).toBe(true)
  })
  it('reports a repairable partial failure instead of registration success', async () => {
    m.sync.mockRejectedValue(new Error('phone already in use'))
    const result = await registerUser('member@example.com', 'password123', 'Member', '0123456789')
    expect(result).toMatchObject({ success: false, code: 'registration-phone-sync-failed' })
    expect('error' in result && result.error.message).toContain('phone already in use')
  })
  it('preserves referral updates after the phone is synchronized', async () => {
    m.referrer.mockResolvedValue({ success: true, user: { id: 'referrer', memberId: 'REF123' } })
    expect((await registerUser('member@example.com', 'password123', 'Member', '0123456789', 'REF123')).success).toBe(true)
    expect(m.update).toHaveBeenCalled()
    expect(m.sync.mock.invocationCallOrder[0]).toBeLessThan(m.update.mock.invocationCallOrder[0])
  })
  it('does not create an account for an invalid phone or attempt synchronization after Auth failure', async () => {
    expect((await registerUser('member@example.com', 'password123', 'Member', '123')).success).toBe(false)
    expect(m.create).not.toHaveBeenCalled()
    m.create.mockRejectedValue({ code: 'auth/email-already-in-use' })
    expect((await registerUser('member@example.com', 'password123', 'Member', '0123456789')).success).toBe(false)
    expect(m.sync).not.toHaveBeenCalled()
  })
})
