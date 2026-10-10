// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ set: vi.fn(), persist: vi.fn(), commit: vi.fn(), get: vi.fn(), queryGet: vi.fn(), getAll: vi.fn(), batchSet: vi.fn(), batchCommit: vi.fn() }));
vi.mock('firebase-admin/firestore', () => {
  const ref = (path: string): any => ({ path, get: m.get, set: m.set, parent: collection(path.split('/').slice(0, -1).join('/')), collection: (id: string) => collection(`${path}/${id}`) });
  const collection = (path: string): any => ({ path, doc: (id: string) => ref(`${path}/${id}`), get: m.queryGet,
    where: () => ({ _queryOptions: { collectionId: path.split('/').filter((_: string, i: number) => i % 2 === 0).join('/') }, get: m.queryGet }) });
  return { FieldValue: { increment: (n: number) => n, serverTimestamp: () => 'timestamp' },
    getFirestore: () => ({ collection, getAll: m.getAll,
      batch: () => ({ set: (...args: any[]) => args[0].path.startsWith('_firestoreMetrics/') ? m.persist(...args) : m.batchSet(...args),
        commit: () => m.commit() }),
      runTransaction: async (fn: any) => { await fn({ get: (r: any) => r.get(), set: m.set }); return fn({ get: (r: any) => r.get(), set: m.set }); },
    }),
  };
});
import { getFirestore, withFirestoreMonitoring } from '../functions/_shared/firestoreMonitoring';
describe('Server monitoring isolation', () => {
  beforeEach(() => { vi.clearAllMocks(); m.commit.mockResolvedValue(undefined); m.set.mockResolvedValue(undefined); });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
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
