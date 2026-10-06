import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ getDocs: vi.fn(), query: vi.fn((...args: unknown[]) => args), orderBy: vi.fn((...args: unknown[]) => args) }))
vi.mock('../../config/firebase', () => ({ db: {} }))
vi.mock('./pointsRecords', () => ({ createPointsRecord: vi.fn() }))
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(), addDoc: vi.fn(), updateDoc: vi.fn(),
  getDocs: m.getDocs, query: m.query, orderBy: m.orderBy, documentId: () => '__name__',
  collection: () => 'fees', where: (...args: unknown[]) => args, limit: (count: number) => ({ limit: count }),
  startAfter: (doc: unknown) => ({ after: doc }), Timestamp: { fromDate: (date: Date) => date },
}))
import { getAllMembershipFeeRecords } from './membershipFee'
const document = (id: string, data: object) => ({ id, data: () => data })
describe('admin membership fee retrieval', () => {
  beforeEach(() => { vi.clearAllMocks() })
  it('includes paid records without dueDate and keeps future renewals separate', async () => {
    m.getDocs.mockResolvedValue({ docs: [
      document('paid', { status: 'paid', deductedAt: new Date('2026-10-05'), createdAt: new Date('2026-10-05') }),
      document('future', { status: 'pending', dueDate: new Date('2027-10-05'), createdAt: new Date('2026-10-04') }),
    ] })
    const records = await getAllMembershipFeeRecords()
    expect(records.map(r => r.id)).toEqual(['paid', 'future'])
    expect(records[0].dueDate).toBeNull()
    expect(m.orderBy).toHaveBeenCalledWith('__name__')
    expect(m.orderBy).not.toHaveBeenCalledWith('dueDate', 'desc')
  })
  it('paginates before sorting and applying a result limit', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => document(`old-${i}`, { createdAt: new Date('2020-01-01') }))
    m.getDocs.mockResolvedValueOnce({ docs: first }).mockResolvedValueOnce({ docs: [document('new', { createdAt: new Date('2026-01-01') })] })
    expect((await getAllMembershipFeeRecords(undefined, 1)).map(r => r.id)).toEqual(['new'])
    expect(m.query.mock.calls[1]).toContainEqual({ after: first[999] })
  })
  it('propagates query failures rather than pretending the ledger is empty', async () => {
    m.getDocs.mockRejectedValue(new Error('permission-denied'))
    await expect(getAllMembershipFeeRecords()).rejects.toThrow('permission-denied')
  })
})
