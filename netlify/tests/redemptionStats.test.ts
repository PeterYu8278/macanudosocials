// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const { countRedemptions, syncRedemptionStats, reconcileUserStats } = createRequire(import.meta.url)('../../firebase-functions/redemptionStats.cjs');

function database() {
  const docs = new Map<string, any>();
  const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: docs.has(path), data: () => structuredClone(docs.get(path)) });
  let queue = Promise.resolve();
  const db = {
    collection: (collection: string) => ({
      doc: (id: string) => ({ path: `${collection}/${id}` }),
      where: (field: string, _operator: string, value: string) => ({ collection, field, value }),
    }),
    runTransaction: (callback: any): Promise<any> => {
      const result = queue.then(async () => {
        const writes: Array<() => void> = [];
        const value = await callback({
          get: async (ref: any) => {
            if (writes.length) throw new Error('Read after write');
            return ref.collection ? { docs: [...docs].filter(([path, data]) => path.startsWith(`${ref.collection}/`)
              && data[ref.field] === ref.value).map(([path]) => snapshot(path)) } : snapshot(ref.path);
          },
          set: (ref: any, data: any) => writes.push(() => docs.set(ref.path, structuredClone(data))),
        });
        writes.forEach(write => write());
        return value;
      });
      queue = result.catch(() => {});
      return result;
    },
  };
  return { db, docs };
}
const item = (id: string, status = 'pending', quantity = 1) => ({ id, status, quantity, userId: 'user' });
describe('trusted redemption statistics', () => {
  it('counts only eligible pending/completed items, including legacy completed rows', () => {
    expect(countRedemptions([item('a'), item('b', 'completed', 2), { id: 'old', quantity: 3 },
      { ...item('day'), isDayPass: true }, { ...item('ref'), type: 'referral_reward' },
      item('cancelled', 'cancelled'), item('rejected', 'rejected'), item('bad', 'completed', -1),
      { ...item('other'), userId: 'other' }], 'user')).toEqual({ completedQuantity: 5, pendingQuantity: 1 });
  });
  it('moves pending quantities to completed without increasing occupied quantity', async () => {
    const { db, docs } = database();
    docs.set('redemptionRecords/session', { userId: 'user', redemptions: [item('a')] });
    await syncRedemptionStats(db, 'session');
    docs.set('redemptionRecords/session', { userId: 'user', redemptions: [item('a', 'completed')] });
    await syncRedemptionStats(db, 'session');
    expect(docs.get('_redemptionStats/user')).toMatchObject({ completedQuantity: 1, pendingQuantity: 0 });
  });
  it('is idempotent for duplicate/concurrent notifications and reads current source state', async () => {
    const { db, docs } = database();
    docs.set('redemptionRecords/session', { userId: 'user', redemptions: [item('a', 'completed', 4)] });
    await Promise.all([syncRedemptionStats(db, 'session'), syncRedemptionStats(db, 'session')]);
    expect(docs.get('_redemptionStats/user').completedQuantity).toBe(4);
    expect(await syncRedemptionStats(db, 'session')).toBe(false);
  });
  it('updates edited quantities, releases cancellations and handles deletion/recreation', async () => {
    const { db, docs } = database();
    docs.set('redemptionRecords/session', { userId: 'user', redemptions: [item('a', 'completed', 4)] });
    await syncRedemptionStats(db, 'session');
    docs.set('redemptionRecords/session', { userId: 'user', redemptions: [item('a', 'completed', 2), item('b')] });
    await syncRedemptionStats(db, 'session');
    docs.set('redemptionRecords/session', { userId: 'user', redemptions: [item('a', 'completed', 2), item('b', 'cancelled')] });
    await syncRedemptionStats(db, 'session');
    expect(docs.get('_redemptionStats/user')).toMatchObject({ completedQuantity: 2, pendingQuantity: 0 });
    docs.delete('redemptionRecords/session'); await syncRedemptionStats(db, 'session');
    expect(docs.get('_redemptionStats/user').completedQuantity).toBe(0);
    docs.set('redemptionRecords/session', { userId: 'user', redemptions: [item('a')] });
    await syncRedemptionStats(db, 'session');
    expect(docs.get('_redemptionStats/user').pendingQuantity).toBe(1);
  });
  it('resolves legacy session ownership and handles reassignment atomically', async () => {
    const { db, docs } = database();
    docs.set('visitSessions/session', { userId: 'user' });
    docs.set('redemptionRecords/session', { redemptions: [{ quantity: 3 }] });
    await syncRedemptionStats(db, 'session');
    docs.set('redemptionRecords/session', { userId: 'other', redemptions: [{ quantity: 2 }] });
    await syncRedemptionStats(db, 'session');
    expect(docs.get('_redemptionStats/user').completedQuantity).toBe(0);
    expect(docs.get('_redemptionStats/other').completedQuantity).toBe(2);
  });
  it('refuses an unattributed legacy source without publishing zero', async () => {
    const { db, docs } = database(); docs.set('redemptionRecords/session', { redemptions: [item('a')] });
    await expect(syncRedemptionStats(db, 'session')).rejects.toThrow('OWNER_MISSING');
    expect(docs.has('_redemptionStatsSources/session')).toBe(false);
  });
  it('provides a non-writing preview and a transaction-safe consistency repair', async () => {
    const { db, docs } = database();
    docs.set('_redemptionStatsSources/session', { userId: 'user', completedQuantity: 2, pendingQuantity: 1 });
    expect(await reconcileUserStats(db, 'user')).toEqual({ completedQuantity: 2, pendingQuantity: 1 });
    expect(docs.has('_redemptionStats/user')).toBe(false);
    await reconcileUserStats(db, 'user', true);
    expect(docs.get('_redemptionStats/user')).toMatchObject({ completedQuantity: 2, pendingQuantity: 1 });
  });
  it('does not partially apply a corrupt counter update', async () => {
    const { db, docs } = database();
    docs.set('redemptionRecords/session', { userId: 'user', redemptions: [item('a')] });
    await syncRedemptionStats(db, 'session');
    docs.set('_redemptionStats/user', { completedQuantity: 0, pendingQuantity: 0 });
    docs.set('redemptionRecords/session', { userId: 'user', redemptions: [item('a', 'completed')] });
    await expect(syncRedemptionStats(db, 'session')).rejects.toThrow('INVALID_REDEMPTION_COUNTER');
    expect(docs.get('_redemptionStatsSources/session').pendingQuantity).toBe(1);
    expect(docs.get('_redemptionStats/user').completedQuantity).toBe(0);
  });
});
