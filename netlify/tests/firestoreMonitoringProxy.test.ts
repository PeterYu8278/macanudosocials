// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
const m = vi.hoisted(() => ({ set: vi.fn(), persist: vi.fn(), hourlyPersist: vi.fn(), commit: vi.fn(), get: vi.fn(), queryGet: vi.fn(), getAll: vi.fn(), batchSet: vi.fn(), batchCommit: vi.fn() }));
vi.mock('firebase-admin/firestore', () => {
  const ref = (path: string): any => ({ path, get: m.get, set: m.set, parent: collection(path.split('/').slice(0, -1).join('/')), collection: (id: string) => collection(`${path}/${id}`) });
  const collection = (path: string): any => ({ path, doc: (id: string) => ref(`${path}/${id}`), get: m.queryGet,
    where: () => ({ _queryOptions: { collectionId: path.split('/').filter((_: string, i: number) => i % 2 === 0).join('/') }, get: m.queryGet }) });
  return { FieldValue: { increment: (n: number) => n, serverTimestamp: () => 'timestamp' },
    getFirestore: () => ({ collection, getAll: m.getAll,
      batch: () => ({ set: (...args: any[]) => args[0].path.startsWith('_firestoreMetrics/') ? m.persist(...args)
        : args[0].path.startsWith('_firestoreMetricsHourly/') ? m.hourlyPersist(...args) : m.batchSet(...args),
        commit: () => m.commit() }),
      runTransaction: async (fn: any) => { await fn({ get: (r: any) => r.get(), set: m.set }); return fn({ get: (r: any) => r.get(), set: m.set }); },
    }),
  };
});
import { getFirestore, persistMetrics, withFirestoreMonitoring } from '../functions/_shared/firestoreMonitoring';
describe('Server monitoring isolation', () => {
  beforeEach(() => { vi.clearAllMocks(); m.commit.mockResolvedValue(undefined); m.set.mockResolvedValue(undefined); });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
  it('persists daily and hourly UTC totals in one batch with stable IDs within each bucket', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-11T23:59:00Z'));
    const row = { collection: 'users', feature: 'home', reads: 5, writes: 2, deletes: 0, failures: 1, cacheReads: 3 };
    await persistMetrics([row], 'frontend');
    expect(m.persist.mock.calls[0][1]).toMatchObject({ date: '2026-10-11', reads: 5 });
    expect(m.hourlyPersist.mock.calls[0][1]).toMatchObject({ date: '2026-10-11', hour: '2026-10-11T23', reads: 5 });
    vi.setSystemTime(new Date('2026-10-12T00:00:00Z'));
    await persistMetrics([row], 'frontend');
    expect(m.hourlyPersist.mock.calls[1][1].hour).toBe('2026-10-12T00');
    expect(m.hourlyPersist.mock.calls[1][0].path).not.toBe(m.hourlyPersist.mock.calls[0][0].path);
    expect(m.commit).toHaveBeenCalledTimes(2);
  });
  it('excludes hourly monitoring collections from recursive reporting', async () => {
    vi.stubEnv('NODE_ENV', 'production'); m.get.mockResolvedValue({ exists: true });
    await withFirestoreMonitoring('lookup', async () => { await getFirestore().collection('_firestoreMetricsHourly').doc('hour').get(); });
    expect(m.persist).not.toHaveBeenCalled(); expect(m.hourlyPersist).not.toHaveBeenCalled();
  });
  it('preserves legacy IDs and persists operation rows once with optional counters', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T08:30:00Z'));
    const legacy = { collection: 'users', feature: 'home', reads: 5, writes: 0, deletes: 0, failures: 0, cacheReads: 0 };
    await persistMetrics([legacy], 'frontend');
    const expected = createHash('sha256').update('2026-10-18:frontend:users:home').digest('hex');
    expect(m.persist.mock.calls[0][0].path).toBe(`_firestoreMetrics/${expected}`);
    expect(m.persist.mock.calls[0][1]).not.toHaveProperty('requests');
    await persistMetrics([{ ...legacy, operation: 'home.memberStats', requests: 1, readRequests: 1, latencyMs: 12, latencySamples: 1 }], 'frontend');
    expect(m.persist).toHaveBeenCalledTimes(2);
    expect(m.hourlyPersist).toHaveBeenCalledTimes(2);
    expect(m.persist.mock.calls[1][0].path).not.toBe(m.persist.mock.calls[0][0].path);
    expect(m.persist.mock.calls[1][1]).toMatchObject({ reads: 5, operation: 'home.memberStats', requests: 1, latencyMs: 12 });
  });
  it('counts empty and failed backend reads as requests without inventing document reads', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    m.queryGet.mockResolvedValueOnce({ size: 0 });
    m.get.mockRejectedValueOnce(new Error('quota'));
    await withFirestoreMonitoring('lookup', async () => {
      await getFirestore().collection('users').get();
      await expect(getFirestore().collection('users').doc('secret').get()).rejects.toThrow('quota');
    });
    expect(m.persist.mock.calls[0][1]).toMatchObject({ reads: 0, failures: 1, requests: 2, readRequests: 2, latencySamples: 2 });
  });
  it('preserves transaction retries, records writes once, and excludes IDs', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    m.get.mockResolvedValue({ exists: true });
    m.commit.mockResolvedValue(undefined);
    const result = await withFirestoreMonitoring('activate-membership', async () => {
      const db = getFirestore();
      const ref = db.collection('users').doc('private-id');
      return db.runTransaction(async tx => { await tx.get(ref); tx.set(ref, { role: 'vip' }); return 'ok'; });
    });
    expect(result).toBe('ok');
    expect(m.set).toHaveBeenCalledTimes(2);
    expect(m.persist.mock.calls[0][1]).toMatchObject({ collection: 'users', reads: 2, writes: 1, feature: 'activate-membership' });
    expect(JSON.stringify(m.persist.mock.calls[0][1])).not.toContain('private-id');
    vi.unstubAllEnvs();
  });
  it('does not fail business requests when reporting fails', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    m.commit.mockRejectedValue(new Error('quota'));
    await expect(withFirestoreMonitoring('test', async () => { await getFirestore().collection('users').doc('id').get(); return 123; })).resolves.toBe(123);
    vi.unstubAllEnvs();
  });
  it('observes writes through snapshot refs and removes subcollection document IDs', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const db = getFirestore();
    const raw = { path: 'users/private-id/fcmTokens/private-token', set: m.set };
    m.queryGet.mockResolvedValue({ size: 1, docs: [{ ref: raw }], forEach: (fn: any) => fn({ ref: raw }) });
    await withFirestoreMonitoring('send-notification', async () => {
      const results = await db.collection('users').doc('private-id').collection('fcmTokens').where('active', '==', true).get();
      await results.docs[0].ref.set({ active: false });
      const writes: Promise<any>[] = [];
      results.forEach(doc => { writes.push(doc.ref.set({ active: false })); });
      await Promise.all(writes);
    });
    expect(m.persist.mock.calls[0][1]).toMatchObject({ collection: 'users/fcmTokens', reads: 1, writes: 2 });
    expect(JSON.stringify(m.persist.mock.calls)).not.toContain('private-id');
    expect(JSON.stringify(m.persist.mock.calls)).not.toContain('private-token');
  });
  it('attributes getAll results to each collection', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    m.getAll.mockResolvedValue([{ ref: { path: 'users/id/fcmTokens/token' } }, { ref: { path: 'orders/private-order' } }]);
    await withFirestoreMonitoring('lookup-member', async () => { await getFirestore().getAll({} as any); });
    expect(m.persist.mock.calls.map(([, row]) => row.collection)).toEqual(['users/fcmTokens', 'orders']);
  });
  it('keeps chained batch writes pending until commit', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await withFirestoreMonitoring('bulk-create-users', async () => {
      const db = getFirestore();
      await db.batch().set(db.collection('users').doc('id'), {}).set(db.collection('orders').doc('id'), {}).commit();
    });
    expect(m.batchSet).toHaveBeenCalledTimes(2);
    expect(m.persist.mock.calls.map(([, row]) => [row.collection, row.writes])).toEqual([['users', 1], ['orders', 1]]);
  });
  it('bounds reporting latency when Firestore telemetry stalls', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.useFakeTimers();
    m.commit.mockImplementation(() => new Promise(() => {}));
    m.get.mockResolvedValue({ exists: true });
    const result = withFirestoreMonitoring('phone-login', async () => {
      await getFirestore().collection('users').doc('id').get(); return 'login-result';
    });
    await vi.advanceTimersByTimeAsync(1500);
    await expect(result).resolves.toBe('login-result');
  });
});
