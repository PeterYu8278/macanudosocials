import { createHash, randomUUID } from 'node:crypto'
import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections'

const collections = [C.RELOAD_RECORDS, C.POINTS_RECORDS, C.MEMBERSHIP_FEE_RECORDS,
  C.VISIT_SESSIONS, C.REDEMPTION_RECORDS, C.ORDERS, C.OUTBOUND_ORDERS, C.INVENTORY_MOVEMENTS]
export const validMigrationBatch = (value: unknown): value is string => typeof value === 'string' && /^legacy_[a-f0-9]{24}$/.test(value)

export function migrationMaintenanceRunning(maintenance: any, now = Date.now()) {
  if (maintenance?.status !== 'running') return false
  const started = maintenance.startedAt?.toDate?.() || maintenance.startedAt
  const time = started instanceof Date ? started.getTime() : NaN
  return !Number.isFinite(time) || now - time < 15 * 60 * 1000
}

export async function previewMigrationCleanup(db: Firestore, batchId: string) {
  if (!validMigrationBatch(batchId)) throw new Error('INVALID_BATCH')
  const records: QueryDocumentSnapshot[] = []
  const counts: Record<string, number> = {}
  for (const name of collections) {
    const snapshot = await db.collection(name).where('migration.batchId', '==', batchId).limit(5001).get()
    if (snapshot.docs.length > 5000) throw new Error('BATCH_TOO_LARGE')
    const scoped = snapshot.docs.filter(document => document.data().migration?.source === 'legacy_workbook'
      && document.data().migration?.batchId === batchId)
    counts[name] = scoped.length
    records.push(...scoped)
  }
  records.sort((a, b) => a.ref.path.localeCompare(b.ref.path))
  const token = createHash('sha256').update(JSON.stringify(records.map(document => [
    document.ref.path, document.updateTime.toMillis(), document.data(),
  ]))).digest('hex')
  return { records, counts, token, total: records.length }
}

export async function archiveMigrationBatch(db: Firestore, batchId: string, token: string, actorId: string) {
  const preview = await previewMigrationCleanup(db, batchId)
  if (!token || token !== preview.token) throw new Error('PREVIEW_CHANGED')
  const batchRef = db.collection(C.MIGRATION_BATCHES).doc(batchId)
  const operationRef = batchRef.collection('cleanupOperations').doc(randomUUID())
  await db.runTransaction(async tx => {
    const current = await tx.get(batchRef)
    if (migrationMaintenanceRunning(current.data()?.maintenance)) throw new Error('MAINTENANCE_RUNNING')
    tx.set(batchRef, { maintenance: { status: 'running', operationId: operationRef.id, actorId, startedAt: new Date() } }, { merge: true })
    tx.set(operationRef, { actorId, batchId, status: 'running', counts: preview.counts, total: preview.total, startedAt: new Date() })
  })
  let archived = 0
  try {
    for (let offset = 0; offset < preview.records.length; offset += 100) {
      const writes = db.batch()
      for (const document of preview.records.slice(offset, offset + 100)) {
        const backupId = createHash('sha256').update(document.ref.path).digest('hex')
        writes.set(operationRef.collection('records').doc(backupId), {
          originalPath: document.ref.path, data: document.data(), archivedAt: new Date(), actorId,
        })
        // A concurrently edited document must never be deleted using an old preview.
        writes.delete(document.ref, { lastUpdateTime: document.updateTime })
      }
      await writes.commit()
      archived += Math.min(100, preview.records.length - offset)
    }
    const remaining = await previewMigrationCleanup(db, batchId)
    if (remaining.total) throw new Error('PREVIEW_CHANGED')
    await operationRef.set({ status: 'completed', archived, completedAt: new Date() }, { merge: true })
    await batchRef.set({ maintenance: { status: 'completed', operationId: operationRef.id, archived, actorId, completedAt: new Date() } }, { merge: true })
    return { archived, backupPath: operationRef.path }
  } catch (error) {
    await operationRef.set({ status: 'partial', archived, completedAt: new Date() }, { merge: true })
    await batchRef.set({ maintenance: { status: 'partial', operationId: operationRef.id, archived, actorId } }, { merge: true })
    throw new Error(`Cleanup stopped after ${archived} records; backup: ${operationRef.path}. ${error instanceof Error ? error.message : 'CLEANUP_FAILED'}`)
  }
}
