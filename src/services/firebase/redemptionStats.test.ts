import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ listeners: new Map<string, any>(), stop: vi.fn() }));
vi.mock('../../config/firebase', () => ({ db: {} }));
vi.mock('./monitoredFirestore', () => ({
  doc: (_db: unknown, collection: string, id: string) => `${collection}/${id}`,
  onSnapshot: (path: string, _options: unknown, next: any, error: any) => {
    m.listeners.set(path, { next, error }); return m.stop;
  },
}));
import { subscribeToRedemptionStats } from './redemptionStats';
const snapshot = (value?: object, cache = false) => ({ exists: () => value !== undefined, data: () => value, metadata: { fromCache: cache } });
describe('live redemption summary', () => {
  beforeEach(() => { m.listeners.clear(); vi.clearAllMocks(); });
  afterEach(() => m.listeners.clear());
  it('publishes counters without reading redemption history', () => {
    const next = vi.fn(); const stop = subscribeToRedemptionStats('user', next);
    expect([...m.listeners.keys()]).toEqual(['_redemptionStatsMeta/default', '_redemptionStats/user']);
    m.listeners.get('_redemptionStatsMeta/default').next(snapshot({ ready: true }));
    m.listeners.get('_redemptionStats/user').next(snapshot({ version: 1, completedQuantity: 12, pendingQuantity: 2 }));
    expect(next).toHaveBeenLastCalledWith({ userId: 'user', status: 'ready', completedQuantity: 12, pendingQuantity: 2 });
    stop(); expect(m.stop).toHaveBeenCalledTimes(2);
  });
  it('does not display uninitialized or missing cached statistics as zero', () => {
    const next = vi.fn(); subscribeToRedemptionStats('user', next);
    m.listeners.get('_redemptionStatsMeta/default').next(snapshot());
    expect(next.mock.lastCall?.[0].status).toBe('initializing');
    m.listeners.get('_redemptionStatsMeta/default').next(snapshot({ ready: true }));
    m.listeners.get('_redemptionStats/user').next(snapshot(undefined, true));
    expect(next.mock.lastCall?.[0].status).toBe('loading');
    m.listeners.get('_redemptionStats/user').next(snapshot());
    expect(next.mock.lastCall?.[0].status).toBe('ready');
  });
  it('reports permission failures and rejects invalid counts', () => {
    const next = vi.fn(); subscribeToRedemptionStats('user', next);
    m.listeners.get('_redemptionStats/user').next(snapshot({ version: 1, completedQuantity: -1, pendingQuantity: 0 }));
    expect(next.mock.lastCall?.[0].status).toBe('error');
    m.listeners.get('_redemptionStatsMeta/default').error(new Error('denied'));
    expect(next.mock.lastCall?.[0].status).toBe('error');
  });
  it('ignores callbacks after switching accounts/unsubscribing', () => {
    const next = vi.fn(); const stop = subscribeToRedemptionStats('user', next); stop(); next.mockClear();
    m.listeners.get('_redemptionStatsMeta/default').next(snapshot({ ready: true }));
    expect(next).not.toHaveBeenCalled();
  });
});
