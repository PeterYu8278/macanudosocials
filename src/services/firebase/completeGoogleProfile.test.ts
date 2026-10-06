// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ phone: vi.fn(), email: vi.fn(), set: vi.fn(), link: vi.fn(), profile: vi.fn() }))
vi.mock('../../config/firebase', () => ({ auth: { currentUser: { uid: 'member', email: 'member@example.com' } }, db: 'db' }))
vi.mock('firebase/auth', async original => ({ ...await original<typeof import('firebase/auth')>(), linkWithCredential: m.link, updateProfile: m.profile }))
vi.mock('firebase/firestore', async original => ({ ...await original<typeof import('firebase/firestore')>(),
  collection: () => 'users', doc: (...args: unknown[]) => args.join('/'), query: () => 'query',
  getDocs: async () => ({ empty: true }), setDoc: m.set }))
vi.mock('./memberPhone', () => ({ updateMemberPhone: m.phone }))
vi.mock('./memberEmail', () => ({ updateMemberEmail: m.email }))
vi.mock('./appConfig', () => ({ getAppConfig: vi.fn() }))
vi.mock('./passwordResetEmail', () => ({ sendRecoveryEmail: vi.fn() }))
vi.mock('./phoneLogin', () => ({ loginPhoneWithPassword: vi.fn() }))
vi.mock('../../utils/memberId', () => ({ generateMemberId: vi.fn(), getUserByMemberId: vi.fn() }))
import { completeGoogleUserProfile } from './auth'
describe('Google profile completion with protected identity fields', () => {
  beforeEach(() => vi.resetAllMocks())
  it('uses backend identity synchronization and keeps browser writes free of identity changes', async () => {
    expect((await completeGoogleUserProfile('member', 'Member', '0123456789', 'password123')).success).toBe(true)
    expect(m.phone).toHaveBeenCalledWith('member', '+60123456789')
    expect(m.email).toHaveBeenCalledWith('member', 'sync')
    const data = m.set.mock.calls[0][1]
    expect(data.displayName).toBe('Member')
    expect(data).not.toHaveProperty('email')
    expect(data).not.toHaveProperty('profile')
  })
  it('does not write profile data or report success when a phone conflict is rejected', async () => {
    m.phone.mockRejectedValue(new Error('phone in use'))
    expect((await completeGoogleUserProfile('member', 'Member', '0123456789', 'password123')).success).toBe(false)
    expect(m.set).not.toHaveBeenCalled()
  })
})
