// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { GLOBAL_COLLECTIONS as C } from '../src/config/globalCollections';
import { correctLegacyLoungeDebtDetails as correct } from '../src/utils/legacyLoungeReportSnapshot';
const { migrateSnapshots } = createRequire(import.meta.url)('./migrate-lounge-report-snapshots.cjs');

function setup() {
  const report = { storeId: 'lounge', text: 'Original delivered WhatsApp message', delivery: { status: 'delivered', taskId: 'original-task' },
    debt: { closing: 50 }, createdAt: new Date('2026-10-26T16:15:00Z'),
    debtDetails: { businessDate: '2026-10-27', to: '2026-10-26T16:15:00Z', customers: [
      { userId: 'member', reliable: false, reasons: ['wallet-mismatch', 'missing-checkpoint'], walletBalance: 19,
        entryCount: 0, entries: [], opening: null, added: null, repaid: null, outstanding: null }] } };
  const records = new Map<string, any>([[`${C.LOUNGE_TEST_REPORTS}/test`, report]]), writes: string[] = [];
  const ref = (collection: string, id: string): any => ({ id, path: `${collection}/${id}`, parent: { id: collection } });
  const db = { collection: (collection: string) => ({ doc: (id = 'audit') => ref(collection, id) }),
    runTransaction: async (work: any) => {
      const pending: Array<() => void> = [];
      const tx = { get: async (target: any) => ({ exists: records.has(target.path), data: () => records.get(target.path) }),
        create: (target: any, data: any) => pending.push(() => { records.set(target.path, data); writes.push(target.path); }),
        update: (target: any, patch: any) => pending.push(() => { records.set(target.path, { ...records.get(target.path), ...patch }); writes.push(target.path); }) };
      const result = await work(tx); pending.forEach(apply => apply()); return result;
    } };
  return { db, records, writes, report };
}
describe('audited legacy snapshot migration', () => {
  it('dry-runs without any write', async () => {
    const { db, writes } = setup();
    const result = await migrateSnapshots(db, { collections: C, correct, reportId: 'test', kind: 'test' });
    expect(result.results[0]).toMatchObject({ status: 'would-correct', affected: 1 }); expect(writes).toEqual([]);
  });
  it('backs up atomically, preserves the sent message and totals, and safely skips reruns', async () => {
    const { db, records, writes, report } = setup();
    const options = { collections: C, correct, reportId: 'test', kind: 'test', apply: true, actor: 'approved-operator' };
    const result = await migrateSnapshots(db, options);
    const saved = records.get(`${C.LOUNGE_TEST_REPORTS}/test`);
    expect(saved.text).toBe(report.text); expect(saved.delivery).toEqual(report.delivery);
    expect(saved.debt).toEqual(report.debt); expect(saved.createdAt).toEqual(report.createdAt);
    expect(saved.debtDetails.customers[0].reasons).toEqual(['missing-checkpoint']);
    const backup = records.get(`${C.LOUNGE_SNAPSHOT_BACKUPS}/${result.results[0].backupId}`);
    expect(backup.original).toEqual(report);
    expect(writes).toHaveLength(3);
    expect(writes.every(path => [C.LOUNGE_SNAPSHOT_BACKUPS, C.LOUNGE_TEST_REPORTS, C.AUDIT_LOGS].includes(path.split('/')[0]))).toBe(true);
    expect((await migrateSnapshots(db, options)).results[0].status).toBe('unchanged'); expect(writes).toHaveLength(3);
  });
  it('requires an audit actor to apply', async () => {
    const { db, writes } = setup();
    await expect(migrateSnapshots(db, { collections: C, correct, apply: true })).rejects.toThrow('ACTOR_REQUIRED');
    expect(writes).toEqual([]);
  });
});
