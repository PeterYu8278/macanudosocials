// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { archiveMigrationBatch, migrationMaintenanceRunning, previewMigrationCleanup } from '../functions/_shared/legacyMigrationMaintenance'

const target = `legacy_${'a'.repeat(24)}`
const other = `legacy_${'b'.repeat(24)}`
const migrated = (batchId = target) => ({ amount: 100, migration: { source: 'legacy_workbook', batchId } })
function fixture(initial: Array<[string, Record<string, any>]> = []) {
  const docs = new Map(initial)
  const deletions: string[] = []
  const writes: string[] = []
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1),
    collection: (name: string) => collection(`${path}/${name}`),
    set: async (data: any) => { docs.set(path, { ...(docs.get(path) || {}), ...data }); writes.push(path) },
  })
  const snapshot = (path: string, data: any) => ({ ref: ref(path), id: path.split('/').at(-1),
    data: () => data, exists: true, updateTime: { toMillis: () => 1 } })
  const collection = (name: string): any => ({
    doc: (id: string) => ref(`${name}/${id}`),
    where: (_field: string, _op: string, batchId: string) => ({ limit: () => ({ get: async () => ({
      docs: [...docs].filter(([path, data]) => path.startsWith(`${name}/`) && path.split('/').length === 2 && data.migration?.batchId === batchId)
        .map(([path, data]) => snapshot(path, data)),
    }) }) }),
  })
  const db = {
    collection,
    runTransaction: async (callback: any) => callback({ get: async (r: any) => ({ data: () => docs.get(r.path) }),
      set: (r: any, data: any) => { docs.set(r.path, { ...(docs.get(r.path) || {}), ...data }); writes.push(r.path) } }),
    batch: () => {
      const sets: Array<[string, any]> = [], removes: string[] = []
      return { set: (r: any, data: any) => sets.push([r.path, data]),
        delete: (r: any, condition: any) => { expect(condition.lastUpdateTime).toBeTruthy(); removes.push(r.path) },
        commit: async () => { sets.forEach(([path, data]) => { docs.set(path, data); writes.push(path) }); removes.forEach(path => { docs.delete(path); deletions.push(path) }) },
      }
    },
  } as unknown as Firestore
  return { db, docs, deletions, writes }
}

describe('legacy workbook scoped maintenance', () => {
  it('previews only the chosen legacy business batch, excluding users and normal records', async () => {
    const f = fixture([['reloadRecords/a', migrated()], ['pointsRecords/a', migrated()],
      ['reloadRecords/other', migrated(other)], ['reloadRecords/live', { migration: { batchId: target, source: 'normal' } }],
      ['users/member', migrated()]])
    const result = await previewMigrationCleanup(f.db, target)
    expect(result.total).toBe(2)
    expect(result.counts.reloadRecords).toBe(1)
    expect(f.writes).toEqual([])
  })
  it('rejects invalid batches and outdated previews without deleting anything', async () => {
    const f = fixture([['reloadRecords/a', migrated()]])
    await expect(previewMigrationCleanup(f.db, '../users')).rejects.toThrow('INVALID_BATCH')
    const result = await previewMigrationCleanup(f.db, target)
    f.docs.set('reloadRecords/new', migrated())
    await expect(archiveMigrationBatch(f.db, target, result.token, 'operator')).rejects.toThrow('PREVIEW_CHANGED')
    expect(f.deletions).toEqual([])
  })
  it('backs up original records before removing them, retaining other batches and wallet data', async () => {
    const wallet = { membership: { points: 500 }, ...migrated() }
    const f = fixture([['reloadRecords/a', migrated()], ['pointsRecords/a', migrated()],
      ['reloadRecords/other', migrated(other)], ['users/member', wallet]])
    const preview = await previewMigrationCleanup(f.db, target)
    const result = await archiveMigrationBatch(f.db, target, preview.token, 'operator')
    expect(result.archived).toBe(2)
    expect(f.deletions.sort()).toEqual(['pointsRecords/a', 'reloadRecords/a'])
    expect(f.docs.get('users/member')).toEqual(wallet)
    expect(f.docs.has('reloadRecords/other')).toBe(true)
    const backups = [...f.docs.values()].filter(data => data.originalPath)
    expect(backups).toHaveLength(2)
    expect(backups[0].data).toEqual(migrated())
    expect(f.docs.get(`migrationBatches/${target}`)?.maintenance.status).toBe('completed')
  })
  it('blocks a running operation and allows recovery from a timed-out lease', () => {
    const now = Date.now()
    expect(migrationMaintenanceRunning({ status: 'running', startedAt: new Date(now) }, now)).toBe(true)
    expect(migrationMaintenanceRunning({ status: 'running', startedAt: new Date(now - 16 * 60 * 1000) }, now)).toBe(false)
    expect(migrationMaintenanceRunning({ status: 'completed' }, now)).toBe(false)
  })
})
