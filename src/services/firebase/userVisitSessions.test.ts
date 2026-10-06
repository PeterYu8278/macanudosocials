import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ getDocs: vi.fn(), limit: vi.fn((count: number) => ({ limit: count })) }))
vi.mock('../../config/firebase', () => ({ db: {} }))
vi.mock('./firestore', () => ({ COLLECTIONS: {}, createOutboundOrder: vi.fn(), getCigarById: vi.fn() }))
vi.mock('firebase/firestore', () => ({
  collection: () => 'sessions', doc: vi.fn(), getDoc: vi.fn(), getDocs: m.getDocs,
  setDoc: vi.fn(), updateDoc: vi.fn(), query: (...args: unknown[]) => args,
  where: (...args: unknown[]) => args, orderBy: (...args: unknown[]) => args,
  limit: m.limit, Timestamp: {}, arrayUnion: vi.fn(), runTransaction: vi.fn(), onSnapshot: vi.fn(),
}))
import { getUserVisitSessions } from './visitSessions'
describe('user visit retrieval without a composite index', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
  it('sorts all fallback results before applying the requested limit', async () => {
    m.getDocs.mockRejectedValueOnce({ code: 'failed-precondition' }).mockResolvedValueOnce({ docs: [
      { id: 'older', data: () => ({ checkInAt: new Date('2026-07-21') }) },
      { id: 'latest', data: () => ({ checkInAt: new Date('2026-10-05') }) },
    ] })
    expect((await getUserVisitSessions('member', 1)).map(r => r.id)).toEqual(['latest'])
    expect(m.limit).toHaveBeenCalledTimes(1)
  })
  it('preserves the efficient indexed query path', async () => {
    m.getDocs.mockResolvedValueOnce({ docs: [{ id: 'latest', data: () => ({ checkInAt: new Date('2026-10-05') }) }] })
    expect((await getUserVisitSessions('member', 1)).map(r => r.id)).toEqual(['latest'])
    expect(m.getDocs).toHaveBeenCalledTimes(1)
    expect(m.limit).toHaveBeenCalledWith(1)
  })
})
