// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'

const mocks = vi.hoisted(() => ({ documents: new Map<string, Record<string, any>>(), writes: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({
  verifyIdToken: async () => ({ uid: 'operator' }),
  getUserByEmail: async () => ({ uid: 'member' }),
  getUserByPhoneNumber: async () => ({ uid: 'member' }),
  updateUser: async () => ({}),
}) }))
vi.mock('firebase-admin/firestore', async importOriginal => {
  const original = await importOriginal<typeof import('firebase-admin/firestore')>()
  const collection = (name: string): any => ({
    get: async () => ({ docs: [...mocks.documents.entries()]
      .filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === 2)
      .map(([path, data]) => ({ id: path.split('/')[1], data: () => data })) }),
    doc: (id: string) => ({
      get: async () => ({ exists: mocks.documents.has(`${name}/${id}`), data: () => mocks.documents.get(`${name}/${id}`) }),
      set: async (data: Record<string, any>) => { mocks.writes(`${name}/${id}`, data) },
      collection: (child: string) => collection(`${name}/${id}/${child}`),
    }),
  })
  return { ...original, getFirestore: () => ({ collection }) }
})

import { handler } from '../functions/legacy-migration'
const invoke = handler as unknown as (event: unknown) => Promise<{ statusCode: number; body: string }>
const migrate = (stage: string, row: Record<string, unknown>) => invoke({
  httpMethod: 'POST', headers: { authorization: 'Bearer test-token' },
  body: JSON.stringify({ stage, batchId: `legacy_${'a'.repeat(24)}`, rows: [row] }),
})
const memberRow = {
  name: 'Member', email: 'member@example.com', phone: '+60123456789', sourceStatus: 'available',
  membershipActiveFrom: '2025-04-01T00:00:00Z', membershipActiveUntil: '2027-04-01T00:00:00Z',
  membershipIsActive: true,
}
const userWrite = () => mocks.writes.mock.calls.find(([path]) => path === 'users/member')?.[1]

describe('legacy migration member timestamps', () => {
  beforeEach(() => {
    mocks.documents.clear()
    mocks.writes.mockClear()
    mocks.documents.set('users/operator', { role: 'developer' })
    mocks.documents.set('stores/lounge', { name: 'Main Lounge' })
    vi.stubEnv('BULK_IMPORT_DEFAULT_PASSWORD', 'test-password')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('uses the imported join date for new member updatedAt, keeping import time separately', async () => {
    const response = await migrate('users', memberRow)
    expect(JSON.parse(response.body).failedCount).toBe(0)
    const data = userWrite()
    expect(data.updatedAt.isEqual(data.membership.joinDate)).toBe(true)
    expect(data.updatedAt.toDate().toISOString()).toBe(new Date(memberRow.membershipActiveFrom).toISOString())
    expect(data.migration.importedAt).toBeInstanceOf(Timestamp)
  })

  it('preserves an existing join date when importing user data', async () => {
    const joinDate = Timestamp.fromDate(new Date('2024-01-01T00:00:00Z'))
    mocks.documents.set('users/member', { email: memberRow.email, role: 'member', membership: { joinDate } })
    expect(JSON.parse((await migrate('users', memberRow)).body).failedCount).toBe(0)
    expect(userWrite().updatedAt.isEqual(joinDate)).toBe(true)
    expect(userWrite().membership.joinDate.isEqual(joinDate)).toBe(true)
  })

  it('keeps a valid timestamp for visitors without a join date', async () => {
    expect(JSON.parse((await migrate('users', { ...memberRow, membershipActiveFrom: null, membershipActiveUntil: null })).body).failedCount).toBe(0)
    expect(userWrite().updatedAt.isEqual(userWrite().migration.importedAt)).toBe(true)
  })

  it.each([false, true])('membership import uses joinDate for updatedAt (existing date: %s)', async existing => {
    const joinDate = Timestamp.fromDate(new Date('2024-01-01T00:00:00Z'))
    mocks.documents.set('users/member', {
      displayName: 'Member', role: 'member', profile: { phone: memberRow.phone },
      membership: existing ? { joinDate } : {}, migration: { legacySourceStatus: 'available' },
    })
    const occurredAt = '2025-04-01T00:00:00Z'
    const response = await migrate('membership', { phone: memberRow.phone, lounge: 'Main Lounge', occurredAt, sourceStatus: 'successful', amount: 199 })
    expect(JSON.parse(response.body).failedCount).toBe(0)
    const data = userWrite()
    expect(data.updatedAt.isEqual(data.membership.joinDate)).toBe(true)
    expect(data.updatedAt.toDate().toISOString()).toBe(existing ? joinDate.toDate().toISOString() : new Date(occurredAt).toISOString())
    const fee = mocks.writes.mock.calls.find(([path]) => path.startsWith('membershipFeeRecords/'))?.[1]
    expect(fee.updatedAt).toBeInstanceOf(Timestamp)
  })
})
