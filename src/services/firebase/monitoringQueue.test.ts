import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('firebase/app', () => ({ getApps: () => [{}] }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { getIdToken: async () => 'test' } }) }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('merges rejected measurements and waits for the cooldown before replay', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '120' } }))
    .mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const queue = await import('./monitoringQueue');
  queue.recordFirestoreOperation('orders', 'reads', 3);
  await queue.flushFirestoreMonitoring();
  queue.recordFirestoreOperation('orders', 'reads', 2);
  await queue.flushFirestoreMonitoring();
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 120_000);
  await queue.flushFirestoreMonitoring();
  expect(JSON.parse(fetch.mock.calls[1][1].body).rows[0].reads).toBe(5);
});

it('honors a cooldown written by another tab', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const queue = await import('./monitoringQueue');
  queue.recordFirestoreOperation('orders', 'writes');
  localStorage.setItem('firestore-monitoring-cooldown', String(Date.now() + 60_000));
  await queue.flushFirestoreMonitoring();
  expect(fetch).not.toHaveBeenCalled();
});

it('does not replay ambiguous network failures', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('network unavailable'));
  vi.stubGlobal('fetch', fetch);
  const queue = await import('./monitoringQueue');
  queue.recordFirestoreOperation('orders', 'reads');
  await queue.flushFirestoreMonitoring();
  vi.setSystemTime(Date.now() + 120_000);
  await queue.flushFirestoreMonitoring();
  expect(fetch).toHaveBeenCalledTimes(1);
});
