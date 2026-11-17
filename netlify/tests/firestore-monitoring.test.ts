// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ persist: vi.fn(), role: 'developer', verify: vi.fn(), receivedAt: 0, collections: [] as string[] }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}] }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: m.verify }) }));
vi.mock('../functions/_shared/firestoreMonitoring', () => ({ persistMetrics: m.persist }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collection: (name: string) => { m.collections.push(name); return ({
  doc: () => ({ get: async () => ({ data: () => ({ role: m.role }) }) }),
  where: () => ({ limit: () => ({ get: async () => ({ docs: [], size: 0 }) }) }),
}); }, runTransaction: async (fn: any) => fn({ get: async () => ({ data: () => ({ receivedAt: m.receivedAt }) }), set: vi.fn() }) }) }));
import handler from '../functions/firestore-monitoring';
const request = (method: string, body?: unknown, token = 'token') => new Request('https://test/.netlify/functions/firestore-monitoring', {
  method, headers: token ? { Authorization: `Bearer ${token}` } : {}, ...(body ? { body: JSON.stringify(body) } : {}),
});
describe('Monitoring access boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); m.collections = []; m.role = 'developer'; m.receivedAt = 0; m.verify.mockResolvedValue({ uid: crypto.randomUUID() }); });
  it('requires authentication', async () => { expect((await handler(request('GET', undefined, ''))).status).toBe(401); });
  it('rejects non-admin dashboard access', async () => { m.role = 'member'; expect((await handler(request('GET'))).status).toBe(403); });
  it('allows developer dashboard access', async () => { expect((await handler(request('GET'))).status).toBe(200); });
  it('uses hourly storage only when requested and keeps the default daily query compatible', async () => {
    expect((await handler(request('GET'))).status).toBe(200);
    expect(m.collections).toContain('_firestoreMetrics');
    m.collections = [];
    expect((await handler(new Request('https://test/.netlify/functions/firestore-monitoring?granularity=hour&days=7', {
      headers: { Authorization: 'Bearer token' },
    }))).status).toBe(200);
    expect(m.collections).toContain('_firestoreMetricsHourly');
    expect(m.collections).not.toContain('_firestoreMetrics');
  });
  it('rejects an unsupported resolution', async () => {
    expect((await handler(new Request('https://test/.netlify/functions/firestore-monitoring?granularity=minute', {
      headers: { Authorization: 'Bearer token' },
    }))).status).toBe(400);
  });
  it('rejects invalid counters and private telemetry recursion', async () => {
    expect((await handler(request('POST', { rows: [{ collection: '_firestoreMetrics', feature: 'home' }] }))).status).toBe(400);
    expect(m.persist).not.toHaveBeenCalled();
  });
  it('stores validated authenticated browser measurements', async () => {
    const row = { collection: 'orders', feature: 'shop', reads: 3, writes: 1, deletes: 0, failures: 0, cacheReads: 0 };
    expect((await handler(request('POST', { rows: [row] }))).status).toBe(200);
    expect(m.persist).toHaveBeenCalledWith([row], 'frontend');
  });
  it('accepts optional request metrics and fixed labels while dropping unknown fields', async () => {
    const row = { collection: 'users', feature: 'home', reads: 0, writes: 0, deletes: 0, failures: 1, cacheReads: 0,
      operation: 'home.activeVisit', requests: 1, readRequests: 1, latencyMs: 250, latencySamples: 1,
      listenerInitialSnapshots: 1, listenerChangeSnapshots: 2, listenerInitialReads: 0, listenerChangeReads: 4 };
    expect((await handler(request('POST', { rows: [{ ...row, privateField: 'secret' }] }))).status).toBe(200);
    expect(m.persist).toHaveBeenCalledWith([row], 'frontend');
  });
  it.each([
    { operation: 'private@example.com' }, { operation: 'home.activeVisit?token=secret' },
    { requests: -1 }, { readRequests: 0.5 }, { latencyMs: 100_000_001 }, { latencySamples: null },
    { listenerInitialReads: 100_001 },
  ])('rejects invalid optional metadata %j', async extra => {
    const row = { collection: 'users', feature: 'home', reads: 0, writes: 0, deletes: 0, failures: 0, cacheReads: 0, ...extra };
    expect((await handler(request('POST', { rows: [row] }))).status).toBe(400);
    expect(m.persist).not.toHaveBeenCalled();
  });
  it('rejects reports during the shared ingestion cooldown', async () => {
    m.receivedAt = Date.now();
    const row = { collection: 'orders', feature: 'shop', reads: 3, writes: 1, deletes: 0, failures: 0, cacheReads: 0 };
    const response = await handler(request('POST', { rows: [row] }));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(m.persist).not.toHaveBeenCalled();
  });
  it('rejects excessive report sizes', async () => {
    expect((await handler(request('POST', { rows: Array(101).fill({}) }))).status).toBe(400);
    expect(m.persist).not.toHaveBeenCalled();
  });
});
