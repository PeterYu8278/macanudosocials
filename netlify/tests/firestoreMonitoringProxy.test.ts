// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ set: vi.fn(), persist: vi.fn(), commit: vi.fn(), get: vi.fn() }));
vi.mock('firebase-admin/firestore', () => {
  const ref = (path: string): any => ({ path, get: m.get });
  return { FieldValue: { increment: (n: number) => n, serverTimestamp: () => 'timestamp' },
    getFirestore: () => ({ collection: (path: string) => ({ path, doc: (id: string) => ref(`${path}/${id}`) }),
      batch: () => ({ set: m.persist, commit: m.commit }),
      runTransaction: async (fn: any) => { await fn({ get: (r: any) => r.get(), set: m.set }); return fn({ get: (r: any) => r.get(), set: m.set }); },
    }),
  };
});
import { getFirestore, withFirestoreMonitoring } from '../functions/_shared/firestoreMonitoring';
describe('Server monitoring isolation', () => {
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
});
