// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dashboardVisitKeys, getDashboardVisitSummary } from './dashboardVisitStats'
const mocks = vi.hoisted(() => ({ read: vi.fn(), tag: vi.fn((ref: any, _operation: string) => ref) }))
vi.mock('./monitoredFirestore', () => ({ doc: (_db: any, ...parts: string[]) => parts.join('/'),
  getDocFromServer: (...args: any[]) => mocks.read(...args), withMonitoringOperation: mocks.tag }))
vi.mock('../../config/firebase', () => ({ db: {} }))
vi.mock('./dashboardRedemptionStats', () => ({ getDashboardRedemptionSummary: async () => ({ status: 'initializing', hours24: [], days7: [] }) }))
const now = new Date('2026-10-18T04:30:00Z')
const metaPath = '_dashboardVisitStatsMeta/default'
const gate = () => ({ ready: true, version: 1, revision: 1, offsetMinutes: 480, runId: 'run',
  workerCheckedAt: now, occupancy: { ready: true, revision: 1, window: Date.parse('2026-10-18T04:00:00Z'),
    weekStart: Date.parse('2026-10-11T16:00:00Z'), scopes: ['all', 'store_a'] } })
const row = () => ({ version: 1, revision: 1, window: Date.parse('2026-10-18T04:00:00Z'),
  weekStart: Date.parse('2026-10-11T16:00:00Z'),
  hours24: Array(24).fill(2), days7: Array(7).fill(3), asOf: now })

describe('bounded Dashboard summary reader', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-480)
    mocks.read.mockReset().mockImplementation(async (path: string) => ({ data: () => path === metaPath ? gate()
      : path === '_dashboardVisitStats/store_a' ? row() : undefined }))
    mocks.tag.mockClear()
  })
  it('reads exactly 35 documents and tags every read; missing initialized buckets are zero', async () => {
    const result = await getDashboardVisitSummary('a', now)
    expect(result.status).toBe('ready')
    expect(Object.keys(result.counts)).toHaveLength(32)
    expect(Object.values(result.counts).every(value => value === 0)).toBe(true)
    expect(result.occupancy.hours24).toEqual(Array(24).fill(2))
    expect(mocks.read).toHaveBeenCalledTimes(35)
    expect(mocks.tag).toHaveBeenCalledTimes(35)
    expect(mocks.tag.mock.calls.every(call => call[1] === 'dashboard.summary')).toBe(true)
    expect(mocks.read.mock.calls.filter(([path]) => path === metaPath)).toHaveLength(2)
    expect(mocks.read.mock.calls.some(([path]) => path.startsWith('visitSessions'))).toBe(false)
  })
  it('refuses missing bootstrap metadata before reading counters', async () => {
    mocks.read.mockResolvedValue({ data: () => undefined })
    expect((await getDashboardVisitSummary('a', now)).status).toBe('initializing')
    expect(mocks.read).toHaveBeenCalledTimes(1)
  })
  it.each([{ ready: false }, { revision: 2 }, { runId: 'new-bootstrap' }])('fences concurrent source edits/bootstrap %o', async change => {
    let metadataReads = 0
    mocks.read.mockImplementation(async (path: string) => ({ data: () => path === metaPath
      ? (++metadataReads === 1 ? gate() : { ...gate(), ...change }) : undefined }))
    const result = await getDashboardVisitSummary('a', now)
    expect(result.status).not.toBe('ready')
    expect(result.counts).toEqual({})
  })
  it.each([
    { occupancy: { ...gate().occupancy, ready: false, failure: 'interval-cap' } },
    { occupancy: { ...gate().occupancy, revision: 0 } },
    { workerCheckedAt: new Date(now.getTime() - 6 * 60000) },
    { occupancy: { ...gate().occupancy, window: 0 } },
    { occupancy: { ...gate().occupancy, weekStart: undefined } },
  ])('never fabricates occupancy for incomplete or expired snapshots %o', async changes => {
    mocks.read.mockImplementation(async (path: string) => ({ data: () => path === metaPath ? { ...gate(), ...changes }
      : path.includes('/buckets/') ? undefined : row() }))
    const result = await getDashboardVisitSummary('a', now)
    expect(result.status).toBe('ready')
    expect(result.occupancy.status).not.toBe('ready')
    expect(result.occupancy.hours24).toEqual([])
  })
  it('returns explicit zeros for an empty scope in a complete occupancy manifest', async () => {
    const result = await getDashboardVisitSummary('empty-store', now)
    expect(result.occupancy.hours24).toEqual(Array(24).fill(0))
    expect(result.occupancy.days7).toEqual(Array(7).fill(0))
  })
  it('rejects unsupported timezones without any Firestore requests', async () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0)
    expect((await getDashboardVisitSummary('a', now)).status).toBe('timezone')
    expect(mocks.read).not.toHaveBeenCalled()
  })
  it('propagates network errors rather than converting them into zero counts', async () => {
    mocks.read.mockRejectedValue(new Error('offline'))
    await expect(getDashboardVisitSummary('a', now)).rejects.toThrow('offline')
  })
  it('requests only the displayed 15 days, 12 months and five years', () => {
    const keys = dashboardVisitKeys(now)
    expect(keys.filter(key => key.startsWith('daily_'))).toHaveLength(15)
    expect(keys.filter(key => key.startsWith('monthly_'))).toHaveLength(12)
    expect(keys.filter(key => key.startsWith('yearly_'))).toHaveLength(5)
    expect(new Set(keys).size).toBe(32)
  })
})
