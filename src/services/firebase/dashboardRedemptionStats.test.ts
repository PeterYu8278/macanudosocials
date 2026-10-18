// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./monitoredFirestore', () => ({ doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDocFromServer: m.read, withMonitoringOperation: (ref: unknown) => ref }));
vi.mock('../../config/firebase', () => ({ db: {} }));
import { dashboardRedemptionKeys, getDashboardRedemptionSummary } from './dashboardRedemptionStats';
const now = new Date('2026-10-18T16:10:00Z'), meta = '_dashboardRedemptionStatsMeta/default';
beforeEach(() => m.read.mockReset());
it('aligns 24 hourly and seven daily points at Malaysia midnight', () => {
  const keys = dashboardRedemptionKeys(now);
  expect(keys.hours24).toHaveLength(24); expect(keys.days7).toHaveLength(7);
  expect(keys.hours24.at(-1)).toBe('hour_2026-10-18T16');
  expect(keys.days7[0]).toBe('day_2026-10-19');
  expect(keys.days7.at(-1)).toBe('day_2026-10-25');
});
it('uses 33 bounded reads without loading raw redemptions and allows explicit zero after bootstrap', async () => {
  m.read.mockImplementation(async (path: string) => ({ data: () => path === meta ? { ready: true, version: 1, runId: 'a', revision: 1 }
    : path.endsWith('hour_2026-10-18T16') ? { count: 5, version: 1 } : undefined }));
  const result = await getDashboardRedemptionSummary('store_a', now);
  expect(result.status).toBe('ready'); expect(result.hours24.at(-1)).toBe(5); expect(result.days7).toEqual(Array(7).fill(0));
  expect(m.read).toHaveBeenCalledTimes(33);
  expect(m.read.mock.calls.every(([path]) => path.startsWith('_dashboardRedemptionStats'))).toBe(true);
});
it('does not fabricate zero for missing readiness, concurrent migration or corrupt counts', async () => {
  m.read.mockResolvedValue({ data: () => undefined });
  expect((await getDashboardRedemptionSummary('all', now)).status).toBe('initializing');
  let gates = 0;
  m.read.mockImplementation(async (path: string) => ({ data: () => path === meta
    ? { ready: true, version: 1, revision: ++gates, runId: 'a' } : { count: 1, version: 1 } }));
  expect((await getDashboardRedemptionSummary('all', now)).status).toBe('unavailable');
  m.read.mockImplementation(async (path: string) => ({ data: () => path === meta
    ? { ready: true, version: 1, revision: 1, runId: 'a' } : { count: -1, version: 1 } }));
  expect((await getDashboardRedemptionSummary('all', now)).status).toBe('unavailable');
});
it('does not report future-weekday activity before that day starts', async () => {
  m.read.mockImplementation(async (path: string) => ({ data: () => path === meta
    ? { ready: true, version: 1, revision: 1, runId: 'a' } : { count: 8, version: 1 } }));
  expect((await getDashboardRedemptionSummary('all', now)).days7).toEqual([8, 0, 0, 0, 0, 0, 0]);
});
