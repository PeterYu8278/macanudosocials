import { afterEach, beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => {
  vi.resetModules(); localStorage.clear();
  vi.stubEnv('PROD', true); vi.stubGlobal('location', { hostname: 'macanudosocials.com', search: '?utm_source=instagram' });
  vi.stubGlobal('navigator', { doNotTrack: '0', onLine: true });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('retries the same event ID after a network failure and removes acknowledged events', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetch);
  const traffic = await import('./websiteTraffic'); traffic.setTrafficPage('guest_landing'); traffic.recordWebsiteEvent('page_view');
  await traffic.flushWebsiteTraffic();
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11000);
  await traffic.flushWebsiteTraffic(); await traffic.flushWebsiteTraffic();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[0][1].body).events[0].id).toBe(JSON.parse(fetch.mock.calls[1][1].body).events[0].id);
});
it('does not send in development/preview, when DNT is enabled or after opt-out', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const traffic = await import('./websiteTraffic'); traffic.setTrafficPage('guest_landing');
  traffic.setWebsiteTrafficOptOut(true); traffic.recordWebsiteEvent('page_view'); await traffic.flushWebsiteTraffic();
  expect(traffic.getWebsiteAttribution()).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  traffic.setWebsiteTrafficOptOut(false); vi.stubEnv('PROD', false); expect(traffic.trafficAllowed()).toBe(false);
  vi.stubEnv('PROD', true); vi.stubGlobal('navigator', { doNotTrack: '1', onLine: true }); expect(traffic.trafficAllowed()).toBe(false);
});
it('uses one registration-start event per session and never attaches a URL or form contents', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetch);
  const traffic = await import('./websiteTraffic'); traffic.setTrafficPage('guest_landing');
  traffic.recordWebsiteEvent('registration_start'); traffic.recordWebsiteEvent('registration_start'); await traffic.flushWebsiteTraffic();
  const events = JSON.parse(fetch.mock.calls[0][1].body).events;
  expect(events.filter((e: any) => e.type === 'registration_start')).toHaveLength(1);
  expect(events.filter((e: any) => e.type === 'engaged_visit')).toHaveLength(1);
  expect(events[0].source).toBe('instagram'); expect(events[0]).not.toHaveProperty('url');
});
