// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ user: {} as any, record: undefined as any, paidHistory: true, update: vi.fn(), set: vi.fn() }))
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
      where: () => {
        let paidOnly = false
        const query = {
          where: (_field: string, _op: string, value: string) => { paidOnly = value === 'paid'; return query },
          limit: (_count: number) => ({ get: async () => ({ docs: paidOnly
            ? (m.paidHistory ? [{ data: () => ({ status: 'paid', amount: 150 }) }] : [])
            : (m.record ? [snapshot('membershipFeeRecords/pending')] : []) }) }),
        }
        return query
      },
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
    m.user = { role: 'member', status: 'inactive', membership: { points: 200, activeFrom: new Date('2025-01-01') } }
    m.record = undefined
    m.paidHistory = true
  })
  it('requires the first-payment package even when the wallet can afford the annual fee', async () => {
    delete m.user.membership.activeFrom
    m.paidHistory = false
    const response = await activate()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'FIRST_PAYMENT_REQUIRED' })
    expect(m.update).not.toHaveBeenCalled()
    expect(m.set).not.toHaveBeenCalled()
  })
  it('refuses to charge an inactive account with an unexpired membership', async () => {
    m.user.membership.activeUntil = new Date(Date.now() + 86400000)
    const response = await activate()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'MEMBERSHIP_STATUS_UNVERIFIED' })
    expect(m.update).not.toHaveBeenCalled()
  })
  it('keeps renewal classification when a prior fee was paid', async () => {
    m.user.membership.activeFrom = new Date('2025-01-01')
    expect((await activate()).status).toBe(200)
    expect(m.update.mock.calls[0][1]['membership.nextFirstVisitWaiverExpiresAt']).toBeNull()
  })
  it('does not authorize a wallet debit based only on dates or firstActivatedAt', async () => {
    m.paidHistory = false
    m.user.membership.activeUntil = new Date('2026-01-01')
    m.user.membership.firstActivatedAt = new Date('2025-01-01')
    const response = await activate()
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'FIRST_PAYMENT_REQUIRED' })
    expect(m.update).not.toHaveBeenCalled()
    expect(m.set).not.toHaveBeenCalled()
  })
  it('allows wallet renewal with a paid history record even if legacy activation dates are missing', async () => {
    delete m.user.membership.activeFrom
    m.record = { userId: 'member', status: 'paid', renewalType: 'initial' }
    expect((await activate()).status).toBe(200)
    expect(m.update.mock.calls[0][1]).toMatchObject({ 'membership.points': 50, role: 'vip' })
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
