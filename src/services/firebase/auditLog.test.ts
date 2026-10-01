import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ addDoc: vi.fn(), user: { id: 'developer', displayName: 'Developer' } }))
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  addDoc: mocks.addDoc,
  getDocs: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(),
  limit: vi.fn(), startAt: vi.fn(), endAt: vi.fn(),
  Timestamp: { fromDate: (date: Date) => date },
}))
vi.mock('../../config/firebase', () => ({ db: {} }))
vi.mock('../../store/modules/auth', () => ({ useAuthStore: { getState: () => ({ user: mocks.user }) } }))
import { saveAuditLog } from './auditLog'

describe('saveAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.addDoc.mockResolvedValue({ id: 'log' })
  })

  it('removes undefined fields from nested details without mutating the source', async () => {
    const date = new Date('2026-10-01T00:00:00Z')
    const details = { brandId: undefined, brand: 'Macanudo', nested: { missing: undefined, zero: 0, enabled: false }, values: [undefined, null, 'value'], date }
    await saveAuditLog({ module: 'inventory', action: 'update', targetId: 'cigar', description: 'Updated cigar', details })
    expect(mocks.addDoc).toHaveBeenCalledTimes(1)
    expect(mocks.addDoc.mock.calls[0][1]).toMatchObject({
      operatorId: 'developer', targetId: 'cigar',
      details: { brand: 'Macanudo', nested: { zero: 0, enabled: false }, values: [null, 'value'], date },
    })
    expect(mocks.addDoc.mock.calls[0][1].details).not.toHaveProperty('brandId')
    expect(mocks.addDoc.mock.calls[0][1].details.nested).not.toHaveProperty('missing')
    expect(details).toHaveProperty('brandId')
    expect(details.values).toHaveLength(3)
  })

  it('stores absent details as null', async () => {
    await saveAuditLog({ module: 'inventory', action: 'update', targetId: 'cigar', description: 'Updated cigar' })
    expect(mocks.addDoc.mock.calls[0][1].details).toBeNull()
  })

  it('does not interrupt the main operation when logging fails', async () => {
    const error = new Error('permission denied')
    mocks.addDoc.mockRejectedValueOnce(error)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(saveAuditLog({ module: 'inventory', action: 'update', targetId: 'cigar', description: 'Updated cigar' })).resolves.toBeUndefined()
      expect(consoleError).toHaveBeenCalledWith('[AuditLog] Failed to save log:', error)
    } finally {
      consoleError.mockRestore()
    }
  })
})
