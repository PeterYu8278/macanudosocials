// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('registers all worker listeners at startup and keeps updates alive', async () => {
  const handlers = new Map<string, Array<(event: any) => void>>();
  const worker = {
    __WB_MANIFEST: [],
    location: new URL('https://example.com/sw.js'),
    registration: { scope: 'https://example.com/' },
    skipWaiting: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((name: string, handler: (event: any) => void) => {
      handlers.set(name, [...(handlers.get(name) || []), handler]);
    }),
  };
  vi.stubGlobal('self', worker);
  vi.stubGlobal('location', worker.location);
  vi.stubGlobal('registration', worker.registration);
  await import('./sw');
  for (const type of ['message', 'fetch', 'install', 'activate', 'push', 'notificationclick']) {
    expect(handlers.has(type), type).toBe(true);
  }
  expect(handlers.get('fetch')).toHaveLength(1);
  const count = worker.addEventListener.mock.calls.length;
  const waitUntil = vi.fn();
  handlers.get('message')!.forEach(handler => handler({ data: { type: 'SKIP_WAITING' }, waitUntil }));
  expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
  expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  await Promise.resolve();
  expect(worker.addEventListener).toHaveBeenCalledTimes(count);
}, 20000);
