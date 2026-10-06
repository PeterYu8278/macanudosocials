// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Timestamp } from 'firebase-admin/firestore'

const mocks = vi.hoisted(() => ({ documents: new Map<string, Record<string, any>>(), writes: vi.fn(), queries: vi.fn(), commit: vi.fn() }))
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
    where: (field: string, operator: string, values: string[]) => ({
      get: async () => {
        mocks.queries(name, field, operator, values)
        return { docs: [...mocks.documents.entries()]
          .filter(([path, data]) => path.startsWith(`${name}/`) && path.split('/').length === 2
            && values.includes(field === 'profile.phone' ? data.profile?.phone : data[field]))
          .map(([path, data]) => ({ id: path.split('/')[1], data: () => data })) }
      },
    }),
    get: async () => ({ docs: [...mocks.documents.entries()]
      .filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === 2)
      .map(([path, data]) => ({ id: path.split('/')[1], data: () => data })) }),
    doc: (id: string) => ({
      path: `${name}/${id}`,
      get: async () => ({ exists: mocks.documents.has(`${name}/${id}`), data: () => mocks.documents.get(`${name}/${id}`) }),
      set: async (data: Record<string, any>) => { mocks.writes(`${name}/${id}`, data) },
      collection: (child: string) => collection(`${name}/${id}/${child}`),
    }),
  })
  return { ...original, getFirestore: () => ({ collection, batch: () => {
    const pending: Array<[string, Record<string, any>]> = []
    return {
      set: (ref: { path: string }, data: Record<string, any>) => { pending.push([ref.path, data]) },
      commit: async () => {
        await mocks.commit(pending)
        pending.forEach(([path, data]) => mocks.writes(path, data))
      },
    }
  } }) }
})

import { eventHandler as handler } from '../functions/legacy-migration'
const invoke = handler as unknown as (event: unknown) => Promise<{ statusCode: number; body: string }>
const migrate = (stage: string, row: Record<string, unknown> | Record<string, unknown>[]) => invoke({
  httpMethod: 'POST', headers: { authorization: 'Bearer test-token' },
  body: JSON.stringify({ stage, batchId: `legacy_${'a'.repeat(24)}`, rows: Array.isArray(row) ? row : [row] }),
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
    mocks.queries.mockClear()
    mocks.commit.mockReset()
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
    expect(data.createdAt.isEqual(data.membership.joinDate)).toBe(true)
    expect(data.updatedAt.toDate().toISOString()).toBe(new Date(memberRow.membershipActiveFrom).toISOString())
    expect(data.migration.importedAt).toBeInstanceOf(Timestamp)
    expect(mocks.queries).toHaveBeenCalledWith('users', 'profile.phone', 'in', [memberRow.phone])
    expect(mocks.queries).toHaveBeenCalledWith('users', 'email', 'in', [memberRow.email])
  })

  it('preserves an existing join date when importing user data', async () => {
    const joinDate = Timestamp.fromDate(new Date('2024-01-01T00:00:00Z'))
    mocks.documents.set('users/member', { email: memberRow.email, role: 'member', membership: { joinDate } })
    expect(JSON.parse((await migrate('users', memberRow)).body).failedCount).toBe(0)
    expect(userWrite().updatedAt.isEqual(joinDate)).toBe(true)
    expect(userWrite().membership.joinDate.isEqual(joinDate)).toBe(true)
    expect(userWrite()).not.toHaveProperty('createdAt')
  })

  it.each(['developer', 'superAdmin', 'admin', 'storeAdmin'])('reports the source record and reason when skipping a protected %s account', async role => {
    mocks.documents.set('users/member', { email: memberRow.email, role })
    const response = await migrate('users', { ...memberRow, sourceRow: 6 })
    expect(response.statusCode).toBe(200)
    const result = JSON.parse(response.body)
    expect(result.skipped).toBe(1)
    expect(result.skippedDetails).toEqual([{
      row: 6, name: memberRow.name, phone: memberRow.phone, email: memberRow.email,
      userId: 'member', role, reason: 'protected-role',
    }])
    expect(userWrite()).toBeUndefined()
    const batchWrite = mocks.writes.mock.calls.find(([, data]) => data.stages)?.[1]
    expect(batchWrite.stages.users.skippedDetails).toEqual(result.skippedDetails)
  })

  it('corrects createdAt for an existing legacy member on re-import', async () => {
    const joinDate = Timestamp.fromDate(new Date('2024-01-01T00:00:00Z'))
    mocks.documents.set('users/member', {
      email: memberRow.email, role: 'member', createdAt: Timestamp.now(),
      membership: { joinDate }, migration: { source: 'legacy_workbook' },
    })
    expect(JSON.parse((await migrate('users', memberRow)).body).failedCount).toBe(0)
    expect(userWrite().createdAt.isEqual(joinDate)).toBe(true)
  })

  it('keeps a valid timestamp for visitors without a join date', async () => {
    expect(JSON.parse((await migrate('users', { ...memberRow, membershipActiveFrom: null, membershipActiveUntil: null })).body).failedCount).toBe(0)
    expect(userWrite().updatedAt.isEqual(userWrite().migration.importedAt)).toBe(true)
    expect(userWrite().createdAt.isEqual(userWrite().migration.importedAt)).toBe(true)
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
    expect(data).not.toHaveProperty('createdAt')
    expect(data.updatedAt.toDate().toISOString()).toBe(existing ? joinDate.toDate().toISOString() : new Date(occurredAt).toISOString())
    const fee = mocks.writes.mock.calls.find(([path]) => path.startsWith('membershipFeeRecords/'))?.[1]
    expect(fee.updatedAt).toBeInstanceOf(Timestamp)
  })

  it('membership import corrects legacy member createdAt using the activation date', async () => {
    mocks.documents.set('users/member', {
      role: 'member', profile: { phone: memberRow.phone }, createdAt: Timestamp.now(),
      migration: { source: 'legacy_workbook', legacySourceStatus: 'available' },
    })
    const response = await migrate('membership', {
      phone: memberRow.phone, lounge: 'Main Lounge', occurredAt: memberRow.membershipActiveFrom,
      sourceStatus: 'successful', amount: 199,
    })
    expect(JSON.parse(response.body).failedCount).toBe(0)
    expect(userWrite().createdAt.isEqual(userWrite().membership.joinDate)).toBe(true)
  })

  it('queries only batch member phones, split into groups of ten', async () => {
    const rows = Array.from({ length: 11 }, (_, index) => {
      const phone = `+6012345${String(index).padStart(4, '0')}`
      mocks.documents.set(`users/member-${index}`, { displayName: `Member ${index}`, profile: { phone } })
      return { phone, lounge: 'Main Lounge', occurredAt: memberRow.membershipActiveFrom, sourceRow: index, amount: 100 }
    })
    const response = JSON.parse((await migrate('reload', rows)).body)
    expect(response.failedCount).toBe(0)
    expect(response.created).toBe(11)
    expect(mocks.queries.mock.calls.map(call => call[3].length)).toEqual([10, 1])
    expect(mocks.writes.mock.calls.filter(([path]) => path.startsWith('pointsRecords/'))).toHaveLength(11)
  })

  it('keeps the latest activation and first imported join date for repeated member rows', async () => {
    mocks.documents.set('users/member', {
      role: 'member', profile: { phone: memberRow.phone },
      migration: { source: 'legacy_workbook', legacySourceStatus: 'available' },
    })
    const row = { phone: memberRow.phone, lounge: 'Main Lounge', sourceStatus: 'successful', amount: 199 }
    const response = JSON.parse((await migrate('membership', [
      { ...row, sourceRow: 1, occurredAt: '2025-04-01T00:00:00Z' },
      { ...row, sourceRow: 2, occurredAt: '2026-04-01T00:00:00Z' },
      { ...row, sourceRow: 3, occurredAt: '2023-04-01T00:00:00Z' },
    ])).body)
    expect(response.failedCount).toBe(0)
    const updates = mocks.writes.mock.calls.filter(([path]) => path === 'users/member').map(([, data]) => data)
    expect(updates).toHaveLength(2)
    expect(updates[1].membership.activeFrom.toDate().toISOString()).toBe('2026-04-01T00:00:00.000Z')
    expect(updates[1].membership.joinDate.toDate().toISOString()).toBe('2025-04-01T00:00:00.000Z')
  })

  it('commits visit and fee records together and reports existing visits as updated', async () => {
    mocks.documents.set('users/member', { displayName: 'Member', profile: { phone: memberRow.phone } })
    const row = { phone: memberRow.phone, lounge: 'Main Lounge', sourceRow: 12,
      occurredAt: '2025-04-01T00:00:00Z', endedAt: '2025-04-01T02:00:00Z', durationMinutes: 120, legacyFeeRm: 40 }
    const result = JSON.parse((await migrate('visits', row)).body)
    expect(result).toMatchObject({ created: 1, updated: 0, failedCount: 0 })
    expect(mocks.commit).toHaveBeenCalledTimes(1)
    const pending = mocks.commit.mock.calls[0][0]
    expect(pending.map(([path]: [string]) => path.split('/')[0])).toEqual(['visitSessions', 'pointsRecords'])
    expect(pending[0][1].pointsRecordId).toBe(pending[1][0].split('/')[1])
    expect(pending[1][1].migration.balanceNotApplied).toBe(true)
    mocks.documents.set(pending[0][0], pending[0][1])
    expect(JSON.parse((await migrate('visits', row)).body)).toMatchObject({ created: 0, updated: 1, failedCount: 0 })
  })

  it('limits parallel visit commits to four members and preserves each member order', async () => {
    const phones = Array.from({ length: 6 }, (_, index) => `+6012345${String(index).padStart(4, '0')}`)
    phones.forEach((phone, index) => mocks.documents.set(`users/member-${index}`, { displayName: `Member ${index}`, profile: { phone } }))
    const rows = [1, 2].flatMap(sourceRow => phones.map(phone => ({ phone, sourceRow, lounge: 'Main Lounge',
      occurredAt: '2025-04-01T00:00:00Z', endedAt: '2025-04-01T02:00:00Z', durationMinutes: 120 })))
    let active = 0
    let peak = 0
    const running = new Set<string>()
    const finished = new Map<string, number[]>()
    mocks.commit.mockImplementation(async pending => {
      const data = pending[0][1]
      expect(running.has(data.userId)).toBe(false)
      running.add(data.userId)
      peak = Math.max(peak, ++active)
      await new Promise(resolve => setTimeout(resolve, 1))
      finished.set(data.userId, [...(finished.get(data.userId) || []), data.migration.sourceRow])
      running.delete(data.userId)
      active -= 1
    })
    expect(JSON.parse((await migrate('visits', rows)).body)).toMatchObject({ created: 12, failedCount: 0 })
    expect(peak).toBe(4)
    expect([...finished.values()]).toEqual(phones.map(() => [1, 2]))
  })

  it('reports failed visit commits and continues importing other rows', async () => {
    mocks.documents.set('users/member', { displayName: 'Member', profile: { phone: memberRow.phone } })
    mocks.commit.mockRejectedValueOnce(new Error('Quota exceeded'))
    const row = { phone: memberRow.phone, lounge: 'Main Lounge',
      occurredAt: '2025-04-01T00:00:00Z', endedAt: '2025-04-01T02:00:00Z', legacyFeeRm: 40 }
    const result = JSON.parse((await migrate('visits', [{ ...row, sourceRow: 1 }, { ...row, sourceRow: 2 }])).body)
    expect(result).toMatchObject({ created: 1, failedCount: 1, failed: [{ row: 1, error: 'Quota exceeded' }] })
    expect(mocks.writes.mock.calls.filter(([path]) => path.startsWith('visitSessions/'))).toHaveLength(1)
  })
})
