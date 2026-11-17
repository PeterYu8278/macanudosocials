import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ getDocs: vi.fn(), auth: { currentUser: { uid: 'user' } } }));
vi.mock('../../config/firebase', () => ({ db: {}, auth: m.auth }));
vi.mock('./auditLog', () => ({ saveAuditLog: vi.fn() }));
vi.mock('@/services/firebase/monitoredFirestore', () => ({
  getDocs: m.getDocs, collection: vi.fn(), query: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
  doc: vi.fn(), getDoc: vi.fn(), addDoc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(),
  where: vi.fn(), onSnapshot: vi.fn(), Timestamp: {}, FieldValue: {}, documentId: vi.fn(), runTransaction: vi.fn(),
}));
import { getCigars } from './firestore';
const snapshot = { docs: [{ id: 'cigar', data: () => ({ name: 'Cigar' }) }] };
describe('concurrent cigar queries', () => {
  beforeEach(() => { vi.clearAllMocks(); m.auth.currentUser = { uid: 'user' }; });
  it('shares simultaneous identical reads, but refreshes after completion', async () => {
    m.getDocs.mockResolvedValue(snapshot);
    const [a, b] = await Promise.all([getCigars({ limit: 10 }), getCigars({ limit: 10 })]);
    expect(m.getDocs).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    await getCigars({ limit: 10 });
    expect(m.getDocs).toHaveBeenCalledTimes(2);
  });
  it('keeps accounts and query limits separate', async () => {
    m.getDocs.mockResolvedValue(snapshot);
    const first = getCigars({ limit: 10 });
    const second = getCigars({ limit: 18 });
    m.auth.currentUser = { uid: 'another-user' };
    await Promise.all([first, second, getCigars({ limit: 10 })]);
    expect(m.getDocs).toHaveBeenCalledTimes(3);
  });
  it('allows a fresh retry after a failed query', async () => {
    m.getDocs.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(snapshot);
    await expect(getCigars()).rejects.toThrow('offline');
    await expect(getCigars()).resolves.toHaveLength(1);
  });
});
