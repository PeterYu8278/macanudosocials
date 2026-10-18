import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ feature: 'home', record: vi.fn(), get: vi.fn(), set: vi.fn(), commit: vi.fn(), callback: undefined as any }));
vi.mock('./monitoringQueue', () => ({ recordFirestoreOperation: m.record,
  captureMonitoringContext: (operation?: string) => ({ feature: m.feature, ...(operation ? { operation } : {}) }) }));
vi.mock('firebase/firestore', () => ({
  getDoc: m.get, getDocs: m.get, setDoc: m.set,
  query: (ref: any) => ({ type: 'query', ref }),
  onSnapshot: (_ref: any, next: any) => { m.callback = next; return () => {}; },
  runTransaction: async (_db: any, fn: any) => {
    await fn({ set: m.set }); return fn({ set: m.set });
  },
  writeBatch: () => ({ set: m.set, commit: m.commit }),
}));
import { getDoc, getDocs, query, onSnapshot, runTransaction, writeBatch, withMonitoringOperation } from './monitoredFirestore';
describe('Firestore observation', () => {
  beforeEach(() => { vi.clearAllMocks(); m.feature = 'home'; });
  it('separates cached reads', async () => {
    m.get.mockResolvedValue({ metadata: { fromCache: true } });
    await getDoc({ path: 'users/u' } as any);
    expect(m.record).toHaveBeenCalledWith('users', 'cacheReads', 1, { feature: 'home' }, expect.objectContaining({ requests: 1, readRequests: 1 }));
  });
  it('keeps query collection attribution and document counts', async () => {
    m.get.mockResolvedValue({ size: 10, metadata: { fromCache: false } });
    await getDocs(query({ path: 'orders' } as any));
    expect(m.record).toHaveBeenCalledWith('orders', 'reads', 10, { feature: 'home' }, expect.objectContaining({ requests: 1, latencySamples: 1 }));
  });
  it('rethrows errors without recording successful reads', async () => {
    m.get.mockRejectedValue(new Error('quota'));
    await expect(getDoc({ path: 'users/u' } as any)).rejects.toThrow('quota');
    expect(m.record).toHaveBeenCalledWith('users', 'failures', 1, { feature: 'home' }, expect.objectContaining({ requests: 1, readRequests: 1 }));
    expect(m.record).toHaveBeenCalledTimes(1);
  });
  it('counts changed listener documents', () => {
    onSnapshot({ path: 'orders' } as any, () => {});
    m.callback({ metadata: { fromCache: false }, docChanges: () => [1, 2] });
    expect(m.record).toHaveBeenCalledWith('orders', 'reads', 2, { feature: 'home' }, expect.objectContaining({ listenerInitialReads: 2 }));
  });
  it('counts committed transaction writes once despite retries', async () => {
    await runTransaction({} as any, async tx => { tx.set({ path: 'users/u' } as any, {}); });
    expect(m.set).toHaveBeenCalledTimes(2);
    expect(m.record).toHaveBeenCalledTimes(1);
  });
  it('captures route and fixed operation before an asynchronous read finishes', async () => {
    let finish!: (value: any) => void;
    m.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const ref = query(withMonitoringOperation({ path: 'orders' }, 'pagination.orders') as any);
    const result = getDocs(ref);
    m.feature = 'admin/users';
    finish({ size: 0, metadata: { fromCache: false } });
    await result;
    expect(m.record).toHaveBeenCalledWith('orders', 'reads', 0,
      { feature: 'home', operation: 'pagination.orders' }, expect.objectContaining({ readRequests: 1, latencySamples: 1 }));
  });
  it('keeps listener attribution and separates cache, initial server, and later changes', () => {
    onSnapshot(withMonitoringOperation({ path: 'orders' }, 'dashboard.summary') as any, () => {});
    m.feature = 'profile';
    m.callback({ metadata: { fromCache: true }, docChanges: () => [1, 2] });
    m.callback({ metadata: { fromCache: false }, docChanges: () => [1, 2] });
    m.callback({ metadata: { fromCache: false }, docChanges: () => [1] });
    const calls = m.record.mock.calls;
    expect(calls.map(call => call[3])).toEqual(Array(3).fill({ feature: 'home', operation: 'dashboard.summary' }));
    expect(calls[0][1]).toBe('cacheReads');
    expect(calls[1][4]).toEqual({ listenerInitialSnapshots: 1, listenerInitialReads: 2 });
    expect(calls[2][4]).toEqual({ listenerChangeSnapshots: 1, listenerChangeReads: 1 });
    expect(calls.reduce((sum, call) => sum + (call[4].requests ?? 0), 0)).toBe(1);
  });
  it('ignores unsafe operation labels at runtime and preserves reference identity', () => {
    const ref = { path: 'orders' };
    expect(withMonitoringOperation(ref, 'private@example.com' as any)).toBe(ref);
    onSnapshot(ref as any, () => {});
    m.callback({ metadata: { fromCache: false }, docChanges: () => [] });
    expect(m.record.mock.calls[0][3]).toEqual({ feature: 'home' });
  });
  it('counts chained batches only after successful commit', async () => {
    const batch = writeBatch({} as any);
    batch.set({ path: 'orders/o' } as any, {});
    expect(m.record).not.toHaveBeenCalled();
    m.commit.mockResolvedValue(undefined);
    await batch.set({ path: 'orders/other' } as any, {}).commit();
    expect(m.record).toHaveBeenCalledWith('orders', 'writes', 1, { feature: 'home' }, expect.objectContaining({ requests: 1, latencySamples: 1 }));
    expect(m.record).toHaveBeenCalledTimes(2);
    expect(m.record.mock.calls.reduce((sum, call) => sum + (call[4]?.requests ?? 0), 0)).toBe(1);
  });
});
