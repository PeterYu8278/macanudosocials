// @vitest-environment node
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { collections: C, normalizeVisit, counterKeys, buildOccupancy, syncDashboardVisitStats,
  refreshDashboardVisitOccupancy, MAX_INTERVALS } = require('../../firebase-functions/dashboardVisitStats.cjs')
const { backfill, verifyDashboardCounters } = require('../../scripts/backfill-dashboard-visit-stats.cjs')
const now = Date.parse('2026-10-18T04:30:00Z')
const visit = (fields: any = {}) => ({ userId: 'member', storeId: 'a', status: 'completed',
  checkInAt: new Date('2026-10-18T02:00:00Z'), checkOutAt: new Date('2026-10-18T04:00:00Z'), ...fields })

function database(options: { onQuery?: (path: string) => void } = {}) {
  const docs = new Map<string, any>()
  const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: docs.has(path), data: () => structuredClone(docs.get(path)) })
  let queue = Promise.resolve()
  function ref(path: string): any {
    return { path, collection: (name: string) => query(`${path}/${name}`), get: async () => snapshot(path),
      set: async (data: any, options?: any) => docs.set(path, options?.merge ? { ...docs.get(path), ...structuredClone(data) } : structuredClone(data)) }
  }
  function query(path: string, filters: any[] = [], cap = Infinity, cursor = ''): any {
    return { path, doc: (id: string) => ref(`${path}/${id}`),
      listDocuments: async () => [...new Set([...docs.keys()].filter(key => key.startsWith(`${path}/`))
        .map(key => key.slice(path.length + 1).split('/')[0]))].map(id => ref(`${path}/${id}`)),
      where: (field: string, operator: string, value: any) => query(path, [...filters, [field, operator, value]], cap, cursor),
      orderBy: () => query(path, filters, cap, cursor), limit: (limit: number) => query(path, filters, limit, cursor),
      startAfter: (doc: any) => query(path, filters, cap, doc.id),
      get: async () => {
        const rows = [...docs].filter(([key, value]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1
          && key.split('/').at(-1)! > cursor && filters.every(([field, operator, target]) => value[field] !== null
            && (operator === '>=' ? value[field] >= target : value[field] < target)))
          .sort(([a], [b]) => a.localeCompare(b)).slice(0, cap).map(([key]) => snapshot(key))
        options.onQuery?.(path)
        return { docs: rows, size: rows.length }
      } }
  }
  const db = { doc: ref, collection: (path: string) => query(path), runTransaction: (callback: any): Promise<any> => {
    const result = queue.then(async () => {
      const writes: any[] = []
      const value = await callback({ get: async (reference: any) => {
        if (writes.length) throw new Error('Read after write')
        return reference.get()
      }, set: (reference: any, data: any, options?: any) => writes.push(() => reference.set(data, options)) })
      for (const write of writes) await write()
      return value
    })
    queue = result.catch(() => {})
    return result
  } }
  return { db, docs }
}

describe('Dashboard visit projection', () => {
  it('maintains session counters across retries, store/date edits, deletion and recreation without touching billing', async () => {
    const { db, docs } = database()
    const source = visit({ dayPass: { isPurchased: true }, financial: { fee: 100 } })
    docs.set(`${C.sessions}/s`, source)
    await Promise.all([syncDashboardVisitStats(db, 's'), syncDashboardVisitStats(db, 's')])
    expect(docs.get(`${C.stats}/all/buckets/daily_2026-10-18`).count).toBe(1)
    expect(await syncDashboardVisitStats(db, 's')).toBe(false)
    const checkpoint = docs.get(`${C.sources}/s`)
    checkpoint.source = Object.fromEntries(Object.entries(checkpoint.source).reverse())
    docs.set(`${C.sources}/s`, checkpoint)
    expect(await syncDashboardVisitStats(db, 's')).toBe(false) // Firestore map key order is not application insertion order.
    docs.set(`${C.sessions}/s`, visit({ storeId: 'b', checkInAt: new Date('2025-09-01T00:00:00Z') }))
    await syncDashboardVisitStats(db, 's')
    expect(docs.get(`${C.stats}/store_a/buckets/daily_2026-10-18`).count).toBe(0)
    expect(docs.get(`${C.stats}/store_b/buckets/yearly_2025`).count).toBe(1)
    expect(docs.get(`${C.stats}/all/buckets/monthly_2026-10`).count).toBe(0)
    docs.delete(`${C.sessions}/s`)
    await syncDashboardVisitStats(db, 's')
    expect(docs.get(`${C.stats}/store_b/buckets/yearly_2025`).count).toBe(0)
    docs.set(`${C.sessions}/s`, source)
    await syncDashboardVisitStats(db, 's')
    expect(docs.get(`${C.stats}/all/buckets/daily_2026-10-18`).count).toBe(1)
    expect(docs.get(`${C.sessions}/s`)).toEqual(source)
    expect([...docs.keys()].some(key => key.startsWith('users/'))).toBe(false)
    expect(docs.get(`${C.meta}/default`).ready).not.toBe(true)
  })

  it('uses UTC+08 calendar boundaries and keeps Day Pass/status-independent check-in semantics', () => {
    expect(counterKeys(normalizeVisit(visit({ checkInAt: new Date('2025-12-31T16:00:00Z'), status: 'cancelled' }), 's')))
      .toEqual(['daily_2026-01-01', 'monthly_2026-01', 'yearly_2026'])
    expect(normalizeVisit({ checkInAt: 'not a date' }, 's')).toBeNull()
    expect(normalizeVisit({ checkInAt: null }, 's').start).toBe(0)
  })

  it('deduplicates people across overlapping sessions, stores and days, with inclusive checkout boundaries', () => {
    const sources = [
      normalizeVisit(visit({ checkInAt: new Date('2026-10-10T00:00:00Z') }), 's1'),
      normalizeVisit(visit({ storeId: 'b' }), 's2'),
      normalizeVisit(visit({ userId: '', checkInAt: new Date('2026-10-18T04:00:00Z'), checkOutAt: new Date('2026-10-18T04:00:00Z') }), 'anonymous'),
      normalizeVisit(visit({ userId: 'future', checkInAt: new Date('2026-10-18T05:00:00Z'), checkOutAt: new Date('2026-10-18T06:00:00Z') }), 'future'),
    ]
    const built = buildOccupancy(sources, now)
    expect(built.scopes.get('all').hours24.at(-1)).toBe(2)
    expect(built.scopes.get('all').days7.at(-1)).toBe(3) // Original chart includes future starts within today's bucket.
    expect(built.scopes.get('store_a').hours24.at(-1)).toBe(2)
    expect(built.scopes.get('store_b').hours24.at(-1)).toBe(1)
    expect(built.scopes.get('all').days7[0]).toBe(1)
  })

  it('extends pending visits without writes and honors explicit checkout over pending status', () => {
    const open = normalizeVisit(visit({ status: 'pending', checkOutAt: null, checkInAt: new Date('2020-01-01T00:00:00Z') }), 's')
    expect(buildOccupancy([open], now).scopes.get('all').hours24).toEqual(Array(24).fill(1))
    expect(buildOccupancy([open], now + 24 * 3600000).scopes.get('all').days7).toEqual([1, 0, 0, 0, 0, 0, 0])
    const closed = normalizeVisit(visit({ status: 'pending', checkOutAt: new Date('2026-10-17T00:00:00Z') }), 's')
    expect(closed.open).toBe(false)
    expect(buildOccupancy([closed], now).scopes.get('all').hours24.at(-1)).toBe(0)
    const fallback = normalizeVisit(visit({ checkOutAt: undefined, updatedAt: new Date('2026-10-18T04:00:00Z') }), 's')
    expect(fallback.end).toBe(Date.parse('2026-10-18T04:00:00Z'))
  })

  it('rebuilds bounded overlap snapshots and advances open visits on hour rollover', async () => {
    const { db, docs } = database()
    docs.set(`${C.sessions}/s`, visit({ checkInAt: new Date('2020-01-01T00:00:00Z'), status: 'pending', checkOutAt: null }))
    await syncDashboardVisitStats(db, 's')
    expect(await refreshDashboardVisitOccupancy(db, now)).toBe(false)
    docs.set(`${C.meta}/default`, { ...docs.get(`${C.meta}/default`), ready: true })
    expect(await refreshDashboardVisitOccupancy(db, now)).toBe(true)
    expect(docs.get(`${C.stats}/all`).hours24).toEqual(Array(24).fill(1))
    expect(await refreshDashboardVisitOccupancy(db, now + 3600000)).toBe(true)
    expect(docs.get(`${C.stats}/all`).window).toBe(Date.parse('2026-10-18T05:00:00Z'))
  })
  it('uses Monday-Sunday and keeps Sunday history in the 24-hour view after Monday starts', async () => {
    const { db, docs } = database()
    const monday = Date.parse('2026-10-18T16:30:00Z')
    docs.set(`${C.sessions}/sunday`, visit({ checkInAt: new Date('2026-10-18T04:00:00Z'), checkOutAt: new Date('2026-10-18T05:00:00Z') }))
    await syncDashboardVisitStats(db, 'sunday')
    docs.set(`${C.meta}/default`, { ...docs.get(`${C.meta}/default`), ready: true })
    await refreshDashboardVisitOccupancy(db, monday)
    const result = docs.get(`${C.stats}/all`)
    expect(result.weekStart).toBe(Date.parse('2026-10-18T16:00:00Z'))
    expect(result.days7).toEqual(Array(7).fill(0))
    expect(result.hours24.some((count: number) => count > 0)).toBe(true)
  })

  it('refuses truncated occupancy and marks the workload unavailable', async () => {
    const { db, docs } = database()
    docs.set(`${C.meta}/default`, { version: 1, revision: 1, ready: true })
    for (let i = 0; i <= MAX_INTERVALS; i++) {
      const source = normalizeVisit(visit({ userId: `u${i}` }), `s${i}`)
      docs.set(`${C.sources}/s${i}`, { start: source.start, end: source.end, source })
    }
    expect(await refreshDashboardVisitOccupancy(db, now)).toBe(false)
    expect(docs.get(`${C.meta}/default`).occupancy).toMatchObject({ ready: false, failure: 'interval-cap' })
    expect(docs.has(`${C.stats}/all`)).toBe(false)
  })

  it('fences an occupancy scan when a source revision changes during the query', async () => {
    const options: { onQuery?: (path: string) => void } = {}
    const { db, docs } = database(options)
    docs.set(`${C.sessions}/s`, visit())
    await syncDashboardVisitStats(db, 's')
    docs.set(`${C.meta}/default`, { ...docs.get(`${C.meta}/default`), ready: true })
    options.onQuery = path => {
      if (path === C.sources) docs.set(`${C.meta}/default`, { ...docs.get(`${C.meta}/default`), revision: 2 })
    }
    expect(await refreshDashboardVisitOccupancy(db, now)).toBe(false)
    expect(docs.has(`${C.stats}/all`)).toBe(false)
  })

  it('refuses counter repairs if a source changed while verification was scanning', async () => {
    const options: { onQuery?: (path: string) => void } = {}
    const { db, docs } = database(options)
    docs.set(`${C.sessions}/s`, visit())
    await syncDashboardVisitStats(db, 's')
    docs.set(`${C.stats}/all/buckets/daily_2026-10-18`, { version: 1, count: 99 })
    docs.set(`${C.meta}/default`, { ...docs.get(`${C.meta}/default`), ready: false, bootstrapping: true, runId: 'run' })
    options.onQuery = path => {
      if (path === C.sources) docs.set(`${C.meta}/default`, { ...docs.get(`${C.meta}/default`), revision: 2 })
    }
    await expect(verifyDashboardCounters(db, { repair: true, runId: 'run' })).rejects.toThrow('BOOTSTRAP_SOURCE_CHANGED')
    expect(docs.get(`${C.stats}/all/buckets/daily_2026-10-18`).count).toBe(99)
  })

  it('does not partially commit corrupt counter changes and invalidates readiness', async () => {
    const { db, docs } = database()
    docs.set(`${C.sessions}/s`, visit())
    await syncDashboardVisitStats(db, 's')
    docs.set(`${C.meta}/default`, { ...docs.get(`${C.meta}/default`), ready: true })
    docs.set(`${C.stats}/all/buckets/daily_2026-10-18`, { count: 0, version: 1 })
    docs.delete(`${C.sessions}/s`)
    await expect(syncDashboardVisitStats(db, 's')).rejects.toThrow('INVALID_VISIT_COUNTER')
    expect(docs.get(`${C.sources}/s`).source).not.toBeNull()
    expect(docs.get(`${C.meta}/default`).ready).toBe(false)
  })

  it('previews without writes, bootstraps all history and repairs missed deletions on rerun', async () => {
    const { db, docs } = database()
    docs.set(`${C.sessions}/s`, visit())
    expect(await backfill(db)).toMatchObject({ mode: 'dry-run', records: 1, verification: { verified: false, unprojectedSources: 1 } })
    expect(docs.size).toBe(1)
    await expect(backfill(db, { apply: true })).rejects.toThrow('DEPLOY_TRIGGER_FIRST')
    await backfill(db, { apply: true, triggerDeployed: true })
    expect(docs.get(`${C.meta}/default`).ready).toBe(true)
    docs.delete(`${C.sessions}/s`)
    await backfill(db, { apply: true, triggerDeployed: true })
    expect(docs.get(`${C.stats}/all/buckets/daily_2026-10-18`).count).toBe(0)
    expect(docs.get(`${C.meta}/default`).ready).toBe(true)
  })

  it('verifies and repairs corrupted, missing and orphaned counters even when source checkpoints are unchanged', async () => {
    const { db, docs } = database()
    docs.set(`${C.sessions}/s`, visit())
    await backfill(db, { apply: true, triggerDeployed: true })
    docs.set(`${C.stats}/all/buckets/daily_2026-10-18`, { count: 99, version: 1 })
    docs.delete(`${C.stats}/store_a/buckets/monthly_2026-10`)
    docs.set(`${C.stats}/store_old/buckets/yearly_2024`, { count: 7, version: 1 })
    expect(await verifyDashboardCounters(db)).toMatchObject({ verified: false, mismatches: 3, repaired: 0 })
    const result = await backfill(db, { apply: true, triggerDeployed: true })
    expect(result.verification).toMatchObject({ verified: true, mismatches: 3, repaired: 3 })
    expect(docs.get(`${C.stats}/all/buckets/daily_2026-10-18`).count).toBe(1)
    expect(docs.get(`${C.stats}/store_a/buckets/monthly_2026-10`).count).toBe(1)
    expect(docs.get(`${C.stats}/store_old/buckets/yearly_2024`).count).toBe(0)
    expect(docs.get(`${C.meta}/default`).ready).toBe(true)
  })

  it('refuses concurrent bootstraps and explicitly restarts an interrupted run with a new fence', async () => {
    const { db, docs } = database()
    docs.set(`${C.meta}/default`, { ready: false, bootstrapping: true, runId: 'abandoned', revision: 0 })
    await expect(backfill(db, { apply: true, triggerDeployed: true })).rejects.toThrow('BOOTSTRAP_ALREADY_RUNNING')
    await backfill(db, { apply: true, triggerDeployed: true, restartIncomplete: true })
    expect(docs.get(`${C.meta}/default`).runId).not.toBe('abandoned')
    expect(docs.get(`${C.meta}/default`).ready).toBe(true)
  })
})
