// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ user: {} as any, record: undefined as any, update: vi.fn(), set: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}] }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: async () => ({ uid: 'member' }) }) }))
vi.mock('firebase-admin/firestore', () => {
  const snapshot = (path: string) => ({ exists: path === 'users/member' || (path === 'membershipFeeRecords/pending' && !!m.record),
    id: path.split('/').at(-1), ref: ref(path), data: () => path === 'users/member' ? m.user : path === 'membershipFeeRecords/pending' ? m.record : undefined })
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path) })
  return {
    Timestamp: class { static fromDate(date: Date) { return date } },
    getFirestore: () => ({ doc: ref, collection: (name: string) => ({
      doc: (id = 'new-record') => ref(`${name}/${id}`),
      where: () => ({ limit: () => ({ get: async () => ({ docs: m.record ? [snapshot('membershipFeeRecords/pending')] : [] }) }) }),
    }), runTransaction: async (fn: any) => fn({ get: async (reference: any) => snapshot(reference.path), update: m.update, set: m.set }) }),
  }
})
import handler from '../functions/activate-membership'
const activate = () => handler(new Request('https://example.com/.netlify/functions/activate-membership', {
  method: 'POST', headers: { Authorization: 'Bearer token' }, body: '{}',
}))

describe('Annual Pass role progression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.user = { role: 'member', status: 'inactive', membership: { points: 200 } }
    m.record = undefined
  })
  it('activates a first-time member as VIP without granting the renewal waiver', async () => {
    expect((await activate()).status).toBe(200)
    const update = m.update.mock.calls[0][1]
    expect(update).toMatchObject({ role: 'vip', status: 'active', 'membership.points': 50 })
    expect(update['membership.activeFrom']).toBeInstanceOf(Date)
    expect(update['membership.activeUntil'].getFullYear()).toBe(update['membership.activeFrom'].getFullYear() + 1)
    expect(update).not.toHaveProperty('membership.nextFirstVisitWaiverExpiresAt')
    expect(m.set.mock.calls.some(([, data]) => data.renewalType === 'initial' && data.status === 'paid')).toBe(true)
  })
  it('keeps the renewal classification for a member with prior Annual Pass dates', async () => {
    m.user.membership.activeFrom = new Date('2025-01-01')
    expect((await activate()).status).toBe(200)
    expect(m.update.mock.calls[0][1]['membership.nextFirstVisitWaiverExpiresAt']).toBeInstanceOf(Date)
  })
  it.each(['vip', 'storeAdmin', 'admin', 'superAdmin', 'developer'])('preserves the %s role', async role => {
    m.user.role = role
    expect((await activate()).status).toBe(200)
    expect(m.update.mock.calls[0][1].role).toBe(role)
  })
  it('does not promote the role when points are insufficient', async () => {
    m.user.membership.points = 10
    expect((await activate()).status).toBe(400)
    expect(m.update).not.toHaveBeenCalled()
  })
})
