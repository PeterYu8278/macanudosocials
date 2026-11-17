// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { collections: C, redemptionBucketKeys, redemptionContributions, syncDashboardRedemptionStats } = require('../../firebase-functions/dashboardRedemptionStats.cjs');
const { backfill } = require('../../scripts/backfill-dashboard-redemption-stats.cjs');

function database() {
  const docs = new Map<string, any>();
  const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: docs.has(path), data: () => structuredClone(docs.get(path)) });
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1),
    get: async () => snapshot(path), collection: (name: string) => query(`${path}/${name}`),
    set: async (data: any, options?: any) => docs.set(path, options?.merge ? { ...docs.get(path), ...structuredClone(data) } : structuredClone(data)) });
  function query(path: string, size = Infinity, cursor = ''): any {
    return { doc: (id: string) => ref(`${path}/${id}`), orderBy: () => query(path, size, cursor),
      limit: (limit: number) => query(path, limit, cursor), startAfter: (last: any) => query(path, size, last.id),
      listDocuments: async () => [...new Set([...docs.keys()].filter(key => key.startsWith(`${path}/`))
        .map(key => `${path}/${key.slice(path.length + 1).split('/')[0]}`))].map(ref),
      get: async () => {
        const rows = [...docs.keys()].filter(key => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1
          && key.split('/').at(-1)! > cursor).sort().slice(0, size).map(snapshot);
        return { docs: rows, size: rows.length };
      } };
  }
  let queue = Promise.resolve();
  const db = { collection: (path: string) => query(path), runTransaction: (work: any) => {
    const result = queue.then(async () => {
      const writes: any[] = [];
      const result = await work({ get: async (reference: any) => {
        if (writes.length) throw new Error('Read after write'); return reference.get();
      }, set: (reference: any, data: any, options?: any) => writes.push(() => reference.set(data, options)),
      update: (reference: any, data: any) => writes.push(() => reference.set(data, { merge: true })) });
      for (const write of writes) await write(); return result;
    }); queue = result.catch(() => {}); return result;
  } };
  return { db, docs };
}
const stamp = new Date('2026-10-18T16:10:00Z');
const item = (fields = {}) => ({ userId: 'member', quantity: 2, status: 'pending', redeemedAt: stamp, ...fields });
const bucket = (scope: string, key: string) => `${C.stats}/${scope}/buckets/${key}`;

describe('Dashboard cigar redemption projection', () => {
  it('sums quantities, uses UTC+08 days and counts pending/completed only without referral rewards', () => {
    expect(redemptionBucketKeys(stamp)).toEqual(['hour_2026-10-18T16', 'day_2026-10-19']);
    const counts = redemptionContributions({ redemptions: [item(), item({ status: 'completed', quantity: 3, isDayPass: true }),
      item({ status: 'cancelled' }), item({ type: 'referral_reward' }), item({ userId: 'other' })] }, { userId: 'member', storeId: 'a' });
    expect(Object.keys(counts)).toHaveLength(4);
    expect(Object.values(counts)).toEqual([5, 5, 5, 5]);
  });
  it('converges on duplicate notifications and completion does not double-count pending quantity', async () => {
    const { db, docs } = database();
    docs.set(`${C.records}/s`, { userId: 'member', storeId: 'a', redemptions: [item()] });
    await Promise.all([syncDashboardRedemptionStats(db, 's'), syncDashboardRedemptionStats(db, 's')]);
    expect(docs.get(bucket('all', 'hour_2026-10-18T16')).count).toBe(2);
    docs.set(`${C.records}/s`, { userId: 'member', storeId: 'a', redemptions: [item({ status: 'completed' })] });
    expect(await syncDashboardRedemptionStats(db, 's')).toBe(false);
    expect(docs.get(bucket('all', 'hour_2026-10-18T16')).count).toBe(2);
  });
  it('moves edited store/time/quantity contributions and removes cancellations or deleted sources', async () => {
    const { db, docs } = database();
    docs.set(`${C.sessions}/s`, { userId: 'member', storeId: 'a' });
    docs.set(`${C.records}/s`, { storeId: 'wrong', redemptions: [item()] });
    await syncDashboardRedemptionStats(db, 's');
    docs.set(`${C.sessions}/s`, { userId: 'member', storeId: 'b' });
    docs.set(`${C.records}/s`, { redemptions: [item({ quantity: 4, redeemedAt: new Date('2026-10-19T01:00:00Z') })] });
    await syncDashboardRedemptionStats(db, 's');
    expect(docs.get(bucket('store_a', 'hour_2026-10-18T16')).count).toBe(0);
    expect(docs.get(bucket('store_b', 'hour_2026-10-19T01')).count).toBe(4);
    docs.delete(`${C.records}/s`); await syncDashboardRedemptionStats(db, 's');
    expect(docs.get(bucket('store_b', 'hour_2026-10-19T01')).count).toBe(0);
    expect([...docs.keys()].some(path => path.startsWith('users/') || path.startsWith('pointsRecords/'))).toBe(false);
  });
  it('fails visibly on missing store attribution or invalid quantity/time', async () => {
    const { db, docs } = database();
    docs.set(`${C.records}/s`, { redemptions: [item()] });
    await expect(syncDashboardRedemptionStats(db, 's')).rejects.toThrow('STORE_REQUIRED');
    expect(docs.get(`${C.meta}/default`).ready).toBe(false);
    expect(() => redemptionContributions({ redemptions: [item({ quantity: -1 })] }, { storeId: 'a' })).toThrow('QUANTITY');
    expect(() => redemptionContributions({ redemptions: [item({ redeemedAt: 'bad' })] }, { storeId: 'a' })).toThrow('TIME');
    expect(() => redemptionContributions({ redemptions: [item({ redeemedAt: null })] }, { storeId: 'a' })).toThrow('TIME');
  });
  it('provides a read-only preview and repairs existing drift before syncing source deletions', async () => {
    const { db, docs } = database();
    docs.set(`${C.records}/s`, { userId: 'member', storeId: 'a', redemptions: [item()] });
    expect((await backfill(db)).mode).toBe('dry-run');
    expect(docs.size).toBe(1);
    await expect(backfill(db, { apply: true })).rejects.toThrow('DEPLOY_TRIGGERS_FIRST');
    await backfill(db, { apply: true, triggerDeployed: true });
    expect(docs.get(`${C.meta}/default`).ready).toBe(true);
    docs.set(bucket('all', 'hour_2026-10-18T16'), { version: 1, count: 0 });
    docs.delete(`${C.records}/s`);
    await backfill(db, { apply: true, triggerDeployed: true });
    expect(docs.get(bucket('all', 'hour_2026-10-18T16')).count).toBe(0);
    expect(docs.get(`${C.meta}/default`).ready).toBe(true);
  });
});
