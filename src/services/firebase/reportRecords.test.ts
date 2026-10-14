import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GLOBAL_COLLECTIONS as C } from '../../config/globalCollections'
const m = vi.hoisted(() => ({ getDocs: vi.fn(), query: vi.fn((...args: unknown[]) => args) }))
vi.mock('../../config/firebase', () => ({ db: {} }))
vi.mock('./monitoredFirestore', () => ({
  collection: (_db: unknown, name: string) => name, documentId: () => '__name__',
  getDocs: m.getDocs, query: m.query, orderBy: (value: string) => ({ orderBy: value }),
  startAfter: (value: unknown) => ({ after: value }), limit: (value: number) => ({ limit: value }),
}))
import { getReportRecords } from './reportRecords'
const document = (id: string, data: object) => ({ id, data: () => data })
describe('complete report record reads', () => {
  beforeEach(() => vi.clearAllMocks())
  it('paginates raw records and includes documents without createdAt', async () => {
    const page = Array.from({ length: 1000 }, (_, index) => document(`record-${index}`, { amount: 1 }))
    m.getDocs.mockResolvedValueOnce({ docs: page }).mockResolvedValueOnce({ docs: [document('last', { createdAt: { toDate: () => new Date('2026-10-01') } })] })
    const result = await getReportRecords<{ id: string; createdAt?: Date }>(C.POINTS_RECORDS)
    expect(result).toHaveLength(1001)
    expect(result[1000].createdAt).toBeInstanceOf(Date)
    expect(m.query.mock.calls[1]).toContainEqual({ after: page[999] })
    expect(m.query.mock.calls[0]).toContainEqual({ orderBy: '__name__' })
  })
  it('propagates read errors rather than exporting misleading empty data', async () => {
    m.getDocs.mockRejectedValue(new Error('permission-denied'))
    await expect(getReportRecords(C.RELOAD_RECORDS)).rejects.toThrow('permission-denied')
  })
  it('preserves the actual Firestore ID even if legacy document data contains a different ID', async () => {
    m.getDocs.mockResolvedValue({ docs: [document('actual', { id: 'stale' })] })
    expect(await getReportRecords(C.USERS)).toEqual([{ id: 'actual' }])
  })
})
