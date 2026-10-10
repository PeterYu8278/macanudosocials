// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections';
const m = vi.hoisted(() => ({ docs: new Map<string, any>(), writes: vi.fn(), metrics: vi.fn(), checkout: vi.fn() }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}] }));
vi.mock('../functions/_shared/pendingVisitCheckout', () => ({ settlePendingVisitCheckout: m.checkout }));
vi.mock('firebase-admin/firestore', () => {
  const ref = (path: string): any => ({ path, get: async () => snapshot(path) });
  const snapshot = (path: string): any => ({ id: path.split('/').at(-1), ref: ref(path), exists: m.docs.has(path), data: () => m.docs.get(path) });
  const collection = (path: string): any => ({ path, doc: (id = 'new') => ref(`${path}/${id}`),
    where: () => ({ _queryOptions: { collectionId: path }, limit() { return this; }, get: async () => {
      const docs = [...m.docs.keys()].filter(key => key.startsWith(`${path}/`)).map(snapshot);
      return { size: docs.length, empty: !docs.length, docs };
    } }),
  });
  return { FieldValue: { increment: (value: number) => value, serverTimestamp: () => 'timestamp' },
    getFirestore: () => ({ collection,
      batch: () => ({ set: m.metrics, commit: async () => {} }),
      runTransaction: async (callback: any) => {
        const updates: Array<() => void> = [];
        const mutation = (reference: any, data: any) => {
          m.writes(reference.path, data);
          updates.push(() => m.docs.set(reference.path, { ...m.docs.get(reference.path), ...data }));
        };
        const result = await callback({ get: async (reference: any) => snapshot(reference.path), update: mutation, set: mutation });
        updates.forEach(apply => apply()); return result;
      },
    }),
  };
});
import handler from '../functions/billplz-callback';
const callback = (valid = true) => {
  const params = new URLSearchParams({ id: 'test-bill', paid: 'true', state: 'paid' });
  const values = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value).join('|');
  params.set('x_signature', valid ? createHmac('sha256', 'test-signature-key').update(values).digest('hex') : 'invalid');
  return handler(new Request('https://example.com/.netlify/functions/billplz-callback', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString(),
  }));
};
describe('Payment callback with monitoring enabled', () => {
  beforeEach(() => {
    vi.clearAllMocks(); m.docs.clear(); vi.stubEnv('NODE_ENV', 'production');
    m.checkout.mockResolvedValue({ status: 'none' });
    m.docs.set(`${C.APP_CONFIG}/default`, { payment: { billplz: { xSignatureKey: 'test-signature-key' } } });
    m.docs.set(`${C.RELOAD_RECORDS}/reload`, { userId: 'private-user', status: 'pending', requestedAmount: 200, pointsEquivalent: 200 });
    m.docs.set(`${C.USERS}/private-user`, { role: 'guest', membership: { points: 10 } });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('preserves signature checks and blocks unauthorized mutations', async () => {
    expect((await callback(false)).status).toBe(401);
    expect(m.writes).not.toHaveBeenCalled();
    expect(m.checkout).not.toHaveBeenCalled();
  });
  it('credits reloads, promotes guests, and attributes transaction writes by collection', async () => {
    expect((await callback()).status).toBe(200);
    expect(m.writes).toHaveBeenCalledWith(`${C.USERS}/private-user`, expect.objectContaining({ role: 'member', 'membership.points': 200 }));
    expect(m.checkout).toHaveBeenCalledTimes(1);
    expect(m.metrics.mock.calls.map(([, row]) => [row.collection, row.writes])).toEqual([
      [C.APP_CONFIG, 0], [C.RELOAD_RECORDS, 1], [C.USERS, 1], [C.POINTS_RECORDS, 1],
    ]);
    expect(JSON.stringify(m.metrics.mock.calls)).not.toContain('private-user');
  });
  it('does not credit a sequentially repeated paid callback twice', async () => {
    expect((await callback()).status).toBe(200);
    m.writes.mockClear();
    expect((await callback()).status).toBe(200);
    expect(m.writes).not.toHaveBeenCalled();
    expect(m.checkout).toHaveBeenCalledTimes(1);
  });
});
