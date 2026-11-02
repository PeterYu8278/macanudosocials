// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ role: 'developer', verify: vi.fn(), persist: vi.fn(), summary: vi.fn(), query: vi.fn() }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], cert: vi.fn(), initializeApp: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: m.verify }) }));
vi.mock('../functions/_shared/websiteTraffic', () => ({ persistWebsiteEvent: m.persist, summarizeWebsiteHours: m.summary }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({ collection: () => ({
  doc: () => ({ get: async () => ({ data: () => ({ role: m.role }) }) }),
  where: (...args: unknown[]) => { m.query(...args); return { where: (...nested: unknown[]) => { m.query(...nested); return { limit: () => ({ get: async () => ({ docs: [], size: 0 }) }) }; } }; },
}) }) }));
import handler from '../functions/website-traffic';
const event = () => ({ id: crypto.randomUUID(), visitor: crypto.randomUUID(), session: crypto.randomUUID(), type: 'page_view',
  page: 'guest_landing', at: Date.now(), capturedAt: Date.now(), source: 'direct', medium: '', campaign: '', loungeId: 'default' });
const post = (body: unknown, origin = 'https://macanudosocials.com', ua = 'Mozilla/5.0') => new Request('https://macanudosocials.com/api/website-traffic', {
  method: 'POST', headers: { origin, 'user-agent': ua }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks(); m.role = 'developer'; m.verify.mockResolvedValue({ uid: 'staff' }); m.persist.mockResolvedValue(true);
  m.summary.mockReturnValue({ counts: {} }); delete process.env.CONTEXT; delete process.env.WEBSITE_TRAFFIC_ENABLED;
});
it('requires a verified authorized role before returning traffic', async () => {
  expect((await handler(new Request('https://site/api/website-traffic'))).status).toBe(401);
  m.role = 'storeAdmin';
  expect((await handler(new Request('https://site/api/website-traffic', { headers: { authorization: 'Bearer token' } }))).status).toBe(403);
  m.verify.mockRejectedValueOnce(new Error('bad token'));
  expect((await handler(new Request('https://site/api/website-traffic', { headers: { authorization: 'Bearer bad' } }))).status).toBe(401);
});
it('accepts sanitized browser events but rejects browser-supplied conversions', async () => {
  expect((await handler(post({ events: [event()] }))).status).toBe(200);
  expect(m.persist).toHaveBeenCalledOnce();
  expect((await handler(post({ events: [{ ...event(), type: 'membership_activated' }] }))).status).toBe(400);
  expect(m.persist).toHaveBeenCalledOnce();
});
it('excludes invalid origins, known bots, previews and disabled collection', async () => {
  expect((await handler(post({ events: [event()] }, 'https://evil.test'))).status).toBe(403);
  await handler(post({ events: [event()] }, undefined, 'Googlebot'));
  process.env.CONTEXT = 'deploy-preview'; await handler(post({ events: [event()] }));
  delete process.env.CONTEXT; process.env.WEBSITE_TRAFFIC_ENABLED = 'false'; await handler(post({ events: [event()] }));
  expect(m.persist).not.toHaveBeenCalled();
});
it('bounds batch size and rejects impossible or overlong date ranges', async () => {
  expect((await handler(post({ events: Array.from({ length: 21 }, event) }))).status).toBe(400);
  for (const params of ['start=2026-02-31&end=2026-03-03', 'start=2026-01-01&end=2026-03-01']) {
    expect((await handler(new Request('https://site/api/website-traffic?' + params, { headers: { authorization: 'Bearer token' } }))).status).toBe(400);
  }
});
it('queries only the requested MYT hour interval and summarizes server-side', async () => {
  const response = await handler(new Request('https://site/api/website-traffic?start=2026-11-01&end=2026-11-02', { headers: { authorization: 'Bearer token' } }));
  expect(response.status).toBe(200); expect(m.query).toHaveBeenCalledWith('hour', '>=', '2026-11-01T00');
  expect(m.query).toHaveBeenCalledWith('hour', '<=', '2026-11-02T23');
});
