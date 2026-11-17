// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { GLOBAL_COLLECTIONS as C } from '../src/config/globalCollections';
import { refreshLoungeDebtHistory } from '../src/utils/refreshLoungeDebtHistory';
const { refreshReports } = createRequire(import.meta.url)('./refresh-lounge-debt-history.cjs');
function setup() {
  const original = { storeId: 'lounge', text: 'Original sent text', debt: { closing: 50 }, delivery: { status: 'delivered' },
    debtDetails: { businessDate: '2026-10-27', from: new Date(2000).toISOString(), to: new Date(3000).toISOString(),
      customers: [{ userId: 'member', walletBalance: 10, reliable: false, reasons: ['missing-checkpoint'], entries: [], entryCount: 0 }], otherReviewCount: 0, truncated: false } };
  const docs = new Map<string, any>([[`${C.LOUNGE_TEST_REPORTS}/report`, original]]), writes: string[] = [];
  const ref = (name: string, id = 'audit'): any => ({ id, path: `${name}/${id}` });
  const db = { collection: (name: string) => {
    const q: any = { doc: (id?: string) => ref(name, id), orderBy: () => q, limit: () => q,
      get: async () => ({ size: [...docs.keys()].filter(k => k.startsWith(`${name}/`)).length,
        docs: [...docs].filter(([k]) => k.startsWith(`${name}/`)).map(([k, data]) => ({ id: k.split('/')[1], ref: { path: k }, data: () => data })) }) };
    return q;
  }, runTransaction: async (work: any) => {
    const pending: Array<() => void> = [];
    const result = await work({ get: async (target: any) => target.get ? { docs: [{ id: 'entry', createTime: { toMillis: () => 1000 }, updateTime: { toMillis: () => 1000 },
      data: () => ({ userId: 'member', source: 'reload', type: 'earn', amount: 10, createdAt: new Date(1500), createdBy: 'legacy_migration' }) }], size: 1 }
      : { exists: docs.has(target.path), data: () => docs.get(target.path) },
      create: (target: any, data: any) => pending.push(() => { docs.set(target.path, data); writes.push(target.path); }),
      update: (target: any, data: any) => pending.push(() => { docs.set(target.path, { ...docs.get(target.path), ...data }); writes.push(target.path); }) });
    pending.forEach(work => work()); return result;
  } };
  return { db, docs, writes, original };
}
describe('versioned debt history refresh', () => {
  it('previews without writes', async () => {
    const { db, writes } = setup(); const result = await refreshReports(db, C, refreshLoungeDebtHistory);
    expect(result.results[0]).toMatchObject({ status: 'would-refresh', reconciled: 1 }); expect(writes).toEqual([]);
  });
  it('backs up and audits the update, preserves all original summary fields, and skips reruns', async () => {
    const { db, docs, writes, original } = setup();
    await refreshReports(db, C, refreshLoungeDebtHistory, { apply: true, actor: 'authorized-user' });
    const saved = docs.get(`${C.LOUNGE_TEST_REPORTS}/report`);
    expect(saved.text).toBe(original.text); expect(saved.debt).toEqual(original.debt); expect(saved.delivery).toEqual(original.delivery);
    expect(saved.debtDetails.customers[0].reliable).toBe(true); expect(writes).toHaveLength(3);
    expect(docs.get(`${C.LOUNGE_SNAPSHOT_BACKUPS}/${saved.historyRefresh.backupId}`).original).toEqual(original);
    expect((await refreshReports(db, C, refreshLoungeDebtHistory, { apply: true, actor: 'authorized-user' })).results[0].status).toBe('unchanged');
    expect(writes).toHaveLength(3);
  });
});
