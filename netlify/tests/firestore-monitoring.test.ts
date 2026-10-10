// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ persist: vi.fn(), role: 'developer', verify: vi.fn(), receivedAt: 0 }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}] }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: m.verify }) }));
vi.mock('../functions/_shared/firestoreMonitoring', () => ({ persistMetrics: m.persist }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collection: () => ({
  doc: () => ({ get: async () => ({ data: () => ({ role: m.role }) }) }),
  where: () => ({ limit: () => ({ get: async () => ({ docs: [], size: 0 }) }) }),
}), runTransaction: async (fn: any) => fn({ get: async () => ({ data: () => ({ receivedAt: m.receivedAt }) }), set: vi.fn() }) }) }));
import handler from '../functions/firestore-monitoring';
const request = (method: string, body?: unknown, token = 'token') => new Request('https://test/.netlify/functions/firestore-monitoring', {
  method, headers: token ? { Authorization: `Bearer ${token}` } : {}, ...(body ? { body: JSON.stringify(body) } : {}),
});
describe('Monitoring access boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); m.role = 'developer'; m.receivedAt = 0; m.verify.mockResolvedValue({ uid: crypto.randomUUID() }); });
  it('requires authentication', async () => { expect((await handler(request('GET', undefined, ''))).status).toBe(401); });
  it('rejects non-admin dashboard access', async () => { m.role = 'member'; expect((await handler(request('GET'))).status).toBe(403); });
  it('allows developer dashboard access', async () => { expect((await handler(request('GET'))).status).toBe(200); });
  it('rejects invalid counters and private telemetry recursion', async () => {
    expect((await handler(request('POST', { rows: [{ collection: '_firestoreMetrics', feature: 'home' }] }))).status).toBe(400);
    expect(m.persist).not.toHaveBeenCalled();
  });
  it('stores validated authenticated browser measurements', async () => {
    const row = { collection: 'orders', feature: 'shop', reads: 3, writes: 1, deletes: 0, failures: 0, cacheReads: 0 };
    expect((await handler(request('POST', { rows: [row] }))).status).toBe(200);
    expect(m.persist).toHaveBeenCalledWith([row], 'frontend');
  });
  it('rejects reports during the shared ingestion cooldown', async () => {
    m.receivedAt = Date.now();
    const row = { collection: 'orders', feature: 'shop', reads: 3, writes: 1, deletes: 0, failures: 0, cacheReads: 0 };
    expect((await handler(request('POST', { rows: [row] }))).status).toBe(429);
    expect(m.persist).not.toHaveBeenCalled();
  });
  it('rejects excessive report sizes', async () => {
    expect((await handler(request('POST', { rows: Array(101).fill({}) }))).status).toBe(400);
    expect(m.persist).not.toHaveBeenCalled();
  });
});
