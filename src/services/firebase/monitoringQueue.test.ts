import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('firebase/app', () => ({ getApps: () => [{}] }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { getIdToken: async () => 'test' } }) }));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  window.history.replaceState({}, '', '/');
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('bounds extended reports below ingress limits and retains every unsent row', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const queue = await import('./monitoringQueue');
  for (let index = 0; index < 100; index++) {
    queue.recordFirestoreOperation(`collection${index}${'x'.repeat(70)}`, 'reads', 2,
      { feature: 'home', operation: 'dashboard.summary' }, {
        requests: 1, readRequests: 1, latencyMs: 123456, latencySamples: 1,
        listenerInitialSnapshots: 1, listenerChangeSnapshots: 1, listenerInitialReads: 1, listenerChangeReads: 1,
      });
  }
  await queue.flushFirestoreMonitoring();
  const first = JSON.parse(fetch.mock.calls[0][1].body).rows;
  expect(first.length).toBeLessThan(100);
  vi.setSystemTime(Date.now() + 60_000);
  await queue.flushFirestoreMonitoring();
  const rows = fetch.mock.calls.flatMap(call => {
    expect(new TextEncoder().encode(call[1].body).length).toBeLessThan(32_000);
    return JSON.parse(call[1].body).rows;
  });
  expect(rows).toHaveLength(100);
  expect(new Set(rows.map(row => row.collection)).size).toBe(100);
});

it('strips dynamic routes and query strings, and keeps operation rows exclusive', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const queue = await import('./monitoringQueue');
  window.history.replaceState({}, '', '/brand/private-id?phone=secret');
  const context = queue.captureMonitoringContext('home.memberStats');
  window.history.replaceState({}, '', '/private-email@example.com?token=secret');
  queue.recordFirestoreOperation('users', 'reads', 5, context, { requests: 1 });
  queue.recordFirestoreOperation('users', 'reads', 2);
  await queue.flushFirestoreMonitoring();
  const body = fetch.mock.calls[0][1].body;
  expect(body).not.toMatch(/private|secret|phone|token/);
  const rows = JSON.parse(body).rows;
  expect(rows).toHaveLength(2);
  expect(rows.map((row: any) => row.feature)).toEqual(['brand', 'unknown']);
  expect(rows.reduce((sum: number, row: any) => sum + row.reads, 0)).toBe(7);
});

it('merges optional counters on a rate limited retry', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 429 }))
    .mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const queue = await import('./monitoringQueue');
  const context = queue.captureMonitoringContext('home.activeVisit');
  queue.recordFirestoreOperation('users', 'reads', 2, context, { requests: 1, latencyMs: 20, latencySamples: 1 });
  await queue.flushFirestoreMonitoring();
  queue.recordFirestoreOperation('users', 'reads', 1, context, { requests: 1, latencyMs: 10, latencySamples: 1 });
  vi.setSystemTime(Date.now() + 60_000);
  await queue.flushFirestoreMonitoring();
  expect(JSON.parse(fetch.mock.calls[1][1].body).rows[0]).toMatchObject({ reads: 3, requests: 2, latencyMs: 30, latencySamples: 2 });
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
