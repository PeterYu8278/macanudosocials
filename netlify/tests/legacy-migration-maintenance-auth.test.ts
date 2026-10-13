// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ role: 'developer', status: 'active', phones: [] as string[], archive: vi.fn(), preview: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: async () => ({ uid: 'operator' }) }) }))
vi.mock('../functions/_shared/firestoreMonitoring', () => ({ getFirestore: () => ({ collection: () => ({
  doc: () => ({ get: async () => ({ data: () => ({ role: m.role, status: m.status }) }) }),
  where: (_field: string, _op: string, values: string[]) => ({ get: async () => ({
    docs: m.phones.filter(phone => values.includes(phone)).map(phone => ({ data: () => ({ profile: { phone } }) })),
  }) }),
}) }) }))
vi.mock('../functions/_shared/legacyMigrationMaintenance', () => ({
  validMigrationBatch: (value: string) => /^legacy_[a-f0-9]{24}$/.test(value),
  archiveMigrationBatch: m.archive, previewMigrationCleanup: m.preview,
}))
import { eventHandler } from '../functions/legacy-migration-maintenance'
const call = eventHandler as unknown as (event: unknown) => Promise<{ statusCode: number; body: string }>
const batchId = `legacy_${'a'.repeat(24)}`
const invoke = (body: object, authorization = 'Bearer token') => call({ httpMethod: 'POST', headers: { authorization }, body: JSON.stringify(body) })

describe('migration cleanup authorization', () => {
  beforeEach(() => { vi.clearAllMocks(); m.role = 'developer'; m.status = 'active'; m.phones = [] })
  it('requires authentication and developer access', async () => {
    expect((await invoke({ action: 'preview', batchId }, '')).statusCode).toBe(401)
    m.role = 'admin'
    expect((await invoke({ action: 'preview', batchId })).statusCode).toBe(403)
    expect(m.preview).not.toHaveBeenCalled()
  })
  it('rejects suspended developers and missing explicit batch confirmation', async () => {
    m.status = 'suspended'
    expect((await invoke({ action: 'archive', batchId, confirmBatchId: batchId })).statusCode).toBe(403)
    m.status = 'active'
    expect((await invoke({ action: 'archive', batchId, previewToken: 'token' })).statusCode).toBe(400)
    expect(m.archive).not.toHaveBeenCalled()
  })
  it('binds archive requests to the confirmed batch, preview token and authenticated actor', async () => {
    m.archive.mockResolvedValue({ archived: 2, backupPath: 'backup' })
    expect((await invoke({ action: 'archive', batchId, confirmBatchId: batchId, previewToken: 'verified' })).statusCode).toBe(200)
    expect(m.archive).toHaveBeenCalledWith(expect.anything(), batchId, 'verified', 'operator')
  })
  it('rejects replacement without valid workbook identities before any deletion', async () => {
    expect((await invoke({ action: 'archive', batchId, confirmBatchId: batchId, previewToken: 'verified', overwrite: true })).statusCode).toBe(400)
    expect(m.archive).not.toHaveBeenCalled()
  })
  it('requires all workbook users to exist before removing the old batch', async () => {
    expect((await invoke({ action: 'archive', batchId, confirmBatchId: batchId, previewToken: 'verified', overwrite: true, phones: ['+60123456789'] })).statusCode).toBe(409)
    expect(m.archive).not.toHaveBeenCalled()
  })
  it('rejects ambiguous phone matches without removing records', async () => {
    m.phones = ['+60123456789', '+60123456789']
    expect((await invoke({ action: 'archive', batchId, confirmBatchId: batchId, previewToken: 'verified', overwrite: true, phones: ['+60123456789'] })).statusCode).toBe(409)
    expect(m.archive).not.toHaveBeenCalled()
  })
  it('allows replacement with existing workbook identities without importing user balances', async () => {
    m.phones = ['+60123456789']
    m.archive.mockResolvedValue({ archived: 2, backupPath: 'backup' })
    expect((await invoke({ action: 'archive', batchId, confirmBatchId: batchId, previewToken: 'verified', overwrite: true, phones: ['+60123456789'] })).statusCode).toBe(200)
    expect(m.archive).toHaveBeenCalledOnce()
  })
})
