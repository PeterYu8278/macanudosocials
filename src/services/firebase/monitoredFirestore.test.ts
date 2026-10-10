import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ record: vi.fn(), get: vi.fn(), set: vi.fn(), commit: vi.fn(), callback: undefined as any }));
vi.mock('./monitoringQueue', () => ({ recordFirestoreOperation: m.record }));
vi.mock('firebase/firestore', () => ({
  getDoc: m.get, getDocs: m.get, setDoc: m.set,
  query: (ref: any) => ({ type: 'query', ref }),
  onSnapshot: (_ref: any, next: any) => { m.callback = next; return () => {}; },
  runTransaction: async (_db: any, fn: any) => {
    await fn({ set: m.set }); return fn({ set: m.set });
  },
  writeBatch: () => ({ set: m.set, commit: m.commit }),
}));
import { getDoc, getDocs, query, onSnapshot, runTransaction, writeBatch } from './monitoredFirestore';
describe('Firestore observation', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it('separates cached reads', async () => {
    m.get.mockResolvedValue({ metadata: { fromCache: true } });
    await getDoc({ path: 'users/u' } as any);
    expect(m.record).toHaveBeenCalledWith('users', 'cacheReads', 1);
  });
  it('keeps query collection attribution and document counts', async () => {
    m.get.mockResolvedValue({ size: 10, metadata: { fromCache: false } });
    await getDocs(query({ path: 'orders' } as any));
    expect(m.record).toHaveBeenCalledWith('orders', 'reads', 10);
  });
  it('rethrows errors without recording successful reads', async () => {
    m.get.mockRejectedValue(new Error('quota'));
    await expect(getDoc({ path: 'users/u' } as any)).rejects.toThrow('quota');
    expect(m.record).toHaveBeenCalledWith('users', 'failures');
    expect(m.record).toHaveBeenCalledTimes(1);
  });
  it('counts changed listener documents', () => {
    onSnapshot({ path: 'orders' } as any, () => {});
    m.callback({ metadata: { fromCache: false }, docChanges: () => [1, 2] });
    expect(m.record).toHaveBeenCalledWith('orders', 'reads', 2);
  });
  it('counts committed transaction writes once despite retries', async () => {
    await runTransaction({} as any, async tx => { tx.set({ path: 'users/u' } as any, {}); });
    expect(m.set).toHaveBeenCalledTimes(2);
    expect(m.record).toHaveBeenCalledTimes(1);
  });
  it('counts chained batches only after successful commit', async () => {
    const batch = writeBatch({} as any);
    batch.set({ path: 'orders/o' } as any, {});
    expect(m.record).not.toHaveBeenCalled();
    m.commit.mockResolvedValue(undefined);
    await batch.set({ path: 'orders/other' } as any, {}).commit();
    expect(m.record).toHaveBeenCalledWith('orders', 'writes');
    expect(m.record).toHaveBeenCalledTimes(2);
  });
});
