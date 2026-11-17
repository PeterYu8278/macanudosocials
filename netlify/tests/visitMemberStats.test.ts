// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const { visitContribution, syncVisitMemberStats, reconcileVisitMemberStats, initializeVisitMemberStats } = require('../../firebase-functions/visitMemberStats.cjs');
const { backfillVisitMemberStats } = require('../../scripts/backfill-visit-member-stats.cjs');

function database() {
  const docs = new Map<string, any>();
  const createdAt = new Date('2026-10-18T03:00:00Z');
  const snapshot = (path: string): any => ({ id: path.split('/').at(-1), exists: docs.has(path),
    createTime: { toDate: () => createdAt }, data: () => structuredClone(docs.get(path)) });
  const read = (ref: any): any => {
    if (ref.path) return snapshot(ref.path);
    const rows = [...docs].filter(([path, data]) => path.startsWith(`${ref.name}/`)
      && ref.filters.every(([key, value]: any) => data[key] === value)
      && (!ref.cursor || path.split('/').at(-1)! > ref.cursor.id))
      .sort(([a], [b]) => a.localeCompare(b)).slice(0, ref.maximum).map(([path]) => snapshot(path));
    return { docs: rows, size: rows.length };
  };
  const collection = (name: string, filters: any[] = [], maximum = Infinity, cursor?: any): any => ({
    name, filters, maximum, cursor,
    doc: (id: string) => ({ path: `${name}/${id}` }),
    where: (field: string, _op: string, value: any) => collection(name, [...filters, [field, value]], maximum, cursor),
    limit: (value: number) => collection(name, filters, value, cursor),
    orderBy: () => collection(name, filters, maximum, cursor),
    startAfter: (value: any) => collection(name, filters, maximum, value),
    get: async () => read(collection(name, filters, maximum, cursor)),
  });
  let queue = Promise.resolve();
  const db = { collection, runTransaction: (callback: any): Promise<any> => {
    const result = queue.then(async () => {
      const writes: Array<() => void> = [];
      const result = await callback({
        get: async (ref: any) => { if (writes.length) throw new Error('read-after-write'); return read(ref); },
        set: (ref: any, data: any) => writes.push(() => docs.set(ref.path, structuredClone(data))),
        update: (ref: any, data: any) => writes.push(() => docs.set(ref.path, { ...docs.get(ref.path), ...structuredClone(data) })),
      });
      writes.forEach(write => write());
      return result;
    });
    queue = result.catch(() => {}); return result;
  } };
  return { db, docs };
}
const visit = (hours = 2, extra: object = {}) => ({ userId: 'member', status: 'completed', durationHours: hours, ...extra });
const hours = (docs: Map<string, any>, userId = 'member') => docs.get(`_visitMemberStats/${userId}`)?.completedHours;

describe('member visit projection', () => {
  it('matches legacy completed non-Day-Pass semantics without persisted membership balances', () => {
    expect(visitContribution(visit()).completedHours).toBe(2);
    expect(visitContribution(visit(20, { checkInType: 'daypass' })).completedHours).toBe(0);
    expect(visitContribution(visit(20, { status: 'pending' })).completedHours).toBe(0);
    expect(visitContribution(visit(20, { status: 'expired' })).completedHours).toBe(0);
    expect(() => visitContribution(visit(-1))).toThrow('INVALID_VISIT_HOURS');
    expect(() => visitContribution({ status: 'completed' })).toThrow('VISIT_OWNER_MISSING');
  });
  it('handles duplicate/concurrent notifications, reads latest state and never double adds hours', async () => {
    const { db, docs } = database(); docs.set('visitSessions/a', visit());
    await Promise.all([syncVisitMemberStats(db, 'a'), syncVisitMemberStats(db, 'a')]);
    expect(hours(docs)).toBe(2);
    expect(await syncVisitMemberStats(db, 'a')).toBe(false);
    docs.set('visitSessions/a', visit(10)); await syncVisitMemberStats(db, 'a');
    expect(hours(docs)).toBe(10);
  });
  it('tracks pending completion, admin edits, Day Pass corrections, deletion and recreation', async () => {
    const { db, docs } = database(); docs.set('visitSessions/a', visit(10, { status: 'pending' }));
    await syncVisitMemberStats(db, 'a'); expect(hours(docs)).toBe(0);
    docs.set('visitSessions/a', visit(10)); await syncVisitMemberStats(db, 'a'); expect(hours(docs)).toBe(10);
    docs.set('visitSessions/a', visit(10, { checkInType: 'daypass' })); await syncVisitMemberStats(db, 'a'); expect(hours(docs)).toBe(0);
    docs.set('visitSessions/a', visit(1.5)); await syncVisitMemberStats(db, 'a');
    docs.delete('visitSessions/a'); await syncVisitMemberStats(db, 'a'); expect(hours(docs)).toBe(0);
    docs.set('visitSessions/a', visit(2.5)); await syncVisitMemberStats(db, 'a'); expect(hours(docs)).toBe(2.5);
  });
  it('moves contributions atomically between owners and refuses corrupted counters', async () => {
    const { db, docs } = database(); docs.set('visitSessions/a', visit()); await syncVisitMemberStats(db, 'a');
    docs.set('visitSessions/a', visit(3, { userId: 'other' })); await syncVisitMemberStats(db, 'a');
    expect(hours(docs)).toBe(0); expect(hours(docs, 'other')).toBe(3);
    docs.set('_visitMemberStats/other', { version: 1, completedHours: 0 });
    docs.delete('visitSessions/a');
    await expect(syncVisitMemberStats(db, 'a')).rejects.toThrow('INVALID_VISIT_COUNTER');
    expect(docs.get('_visitMemberStatsSources/a').completedHours).toBe(3);
  });
  it('offers non-writing reconciliation and repairs totals from checkpoint contributions', async () => {
    const { db, docs } = database(); docs.set('visitSessions/a', visit()); await syncVisitMemberStats(db, 'a');
    docs.set('_visitMemberStats/member', { version: 1, completedHours: 30 });
    expect(await reconcileVisitMemberStats(db, 'member')).toEqual({ completedHours: 2 }); expect(hours(docs)).toBe(30);
    await reconcileVisitMemberStats(db, 'member', true); expect(hours(docs)).toBe(2);
  });
  it('creates zero only for a proven new user with neither visits nor checkpoints', async () => {
    const { db, docs } = database(); docs.set('users/member', {});
    docs.set('_visitMemberStatsMeta/default', { version: 1, ready: true, startedAt: new Date('2026-10-18T02:00:00Z') });
    await initializeVisitMemberStats(db, 'member'); expect(hours(docs)).toBe(0);
    expect(await initializeVisitMemberStats(db, 'member')).toBe(false);
    docs.delete('_visitMemberStats/member'); docs.set('visitSessions/a', visit());
    await expect(initializeVisitMemberStats(db, 'member')).rejects.toThrow('REQUIRES_RECONCILIATION');
    docs.delete('visitSessions/a'); docs.set('_visitMemberStatsSources/a', { userId: 'member', version: 1, completedHours: 2 });
    await expect(initializeVisitMemberStats(db, 'member')).rejects.toThrow('REQUIRES_RECONCILIATION');
    docs.delete('_visitMemberStatsSources/a');
    docs.set('_visitMemberStatsMeta/default', { version: 1, ready: true, startedAt: new Date('2026-10-18T04:00:00Z') });
    await expect(initializeVisitMemberStats(db, 'member')).rejects.toThrow('REQUIRES_RECONCILIATION');
    docs.set('_visitMemberStatsMeta/default', { version: 1, ready: false });
    await expect(initializeVisitMemberStats(db, 'member')).rejects.toThrow('NOT_READY');
    expect(hours(docs)).toBeUndefined();
  });
});

describe('visit projection backfill readiness', () => {
  it('defaults to a read-only preview and applies only with trigger acknowledgement', async () => {
    const { db, docs } = database(); docs.set('users/member', {}); docs.set('users/empty', {});
    docs.set('visitSessions/a', visit());
    const before = structuredClone([...docs]);
    expect(await backfillVisitMemberStats(db)).toMatchObject({ mode: 'dry-run', records: 1, ready: false });
    expect([...docs]).toEqual(before);
    await expect(backfillVisitMemberStats(db, { apply: true })).rejects.toThrow('DEPLOY_TRIGGER_FIRST');
    await backfillVisitMemberStats(db, { apply: true, triggerDeployed: true });
    expect(hours(docs)).toBe(2); expect(hours(docs, 'empty')).toBe(0);
    expect(docs.get('_visitMemberStatsMeta/default')).toMatchObject({ version: 1, ready: true, running: false });
    await backfillVisitMemberStats(db, { apply: true, triggerDeployed: true }); expect(hours(docs)).toBe(2);
  });
  it('never marks incomplete or unattributed history ready and rejects concurrent backfills', async () => {
    const { db, docs } = database(); docs.set('visitSessions/a', { status: 'completed', durationHours: 2 });
    await expect(backfillVisitMemberStats(db, { apply: true, triggerDeployed: true })).rejects.toThrow('VISIT_OWNER_MISSING');
    expect(docs.get('_visitMemberStatsMeta/default')).toMatchObject({ ready: false, running: false });
    docs.set('_visitMemberStatsMeta/default', { running: true });
    await expect(backfillVisitMemberStats(db, { apply: true, triggerDeployed: true })).rejects.toThrow('ALREADY_RUNNING');
  });
  it('paginates all history and accounts for deleted sources on reruns', async () => {
    const { db, docs } = database();
    for (let i = 0; i < 501; i++) docs.set(`visitSessions/a${String(i).padStart(4, '0')}`, visit(0.5));
    await backfillVisitMemberStats(db, { apply: true, triggerDeployed: true }); expect(hours(docs)).toBe(250.5);
    docs.delete('visitSessions/a0000');
    await backfillVisitMemberStats(db, { apply: true, triggerDeployed: true }); expect(hours(docs)).toBe(250);
  });
  it.each([
    ['deleted', null, 2],
    ['reduced', visit(3), 5],
  ] as const)('repairs drifted counters before synchronizing a %s source', async (_label, source, expectedHours) => {
    const { db, docs } = database();
    docs.set('_visitMemberStats/member', { userId: 'member', version: 1, completedHours: 0 });
    docs.set('_visitMemberStatsSources/a', { userId: 'member', version: 1, completedHours: 10 });
    docs.set('_visitMemberStatsSources/b', { userId: 'member', version: 1, completedHours: 2 });
    docs.set('visitSessions/b', visit(2));
    if (source) docs.set('visitSessions/a', source);
    const committed: { hours: number; ready: boolean }[] = [];
    const transact = db.runTransaction;
    db.runTransaction = async callback => {
      const result = await transact(callback);
      committed.push({ hours: hours(docs), ready: docs.get('_visitMemberStatsMeta/default')?.ready });
      return result;
    };
    const before = structuredClone([...docs]);
    await backfillVisitMemberStats(db);
    expect([...docs]).toEqual(before);
    await backfillVisitMemberStats(db, { apply: true, triggerDeployed: true });
    expect(committed).toContainEqual({ hours: 12, ready: false });
    expect(hours(docs)).toBe(expectedHours);
    expect(docs.get('_visitMemberStatsSources/a')).toMatchObject({ completedHours: source ? 3 : 0 });
    expect(committed.filter(state => state.ready)).toEqual([{ hours: expectedHours, ready: true }]);
    await backfillVisitMemberStats(db, { apply: true, triggerDeployed: true });
    expect(hours(docs)).toBe(expectedHours);
  });
  it('preserves a live trigger update between baseline repair and source synchronization', async () => {
    const { db, docs } = database();
    docs.set('_visitMemberStats/member', { userId: 'member', version: 1, completedHours: 0 });
    docs.set('_visitMemberStatsSources/a', { userId: 'member', version: 1, completedHours: 10 });
    docs.set('visitSessions/a', visit(3));
    const transact = db.runTransaction;
    let injected = false;
    db.runTransaction = async callback => {
      const result = await transact(callback);
      if (!injected && hours(docs) === 10 && docs.get('_visitMemberStatsMeta/default')?.ready === false) {
        injected = true;
        docs.set('visitSessions/a', visit(4));
        await syncVisitMemberStats(db, 'a');
      }
      return result;
    };
    await backfillVisitMemberStats(db, { apply: true, triggerDeployed: true });
    expect(injected).toBe(true);
    expect(hours(docs)).toBe(4);
    expect(docs.get('_visitMemberStatsSources/a')).toMatchObject({ completedHours: 4 });
    expect(docs.get('_visitMemberStatsMeta/default')).toMatchObject({ ready: true, running: false });
  });
});
