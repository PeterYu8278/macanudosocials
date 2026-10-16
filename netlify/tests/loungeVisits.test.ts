// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { checkInLounge, deductLoungeRealtime, settleLoungeVisit } from '../functions/_shared/loungeVisits';
import { emptyLoungeOperations } from '../../src/utils/loungeOperations';

let records: Record<string, any>;
let id = 0;
const collection = (name: string, filters: any[] = [], maximum = Infinity): any => ({
  name, filters, maximum,
  doc: (key = `generated-${++id}`) => ({ path: `${name}/${key}`, id: key }),
  where: (field: string, _op: string, value: any) => collection(name, [...filters, [field, value]], maximum),
  limit: (size: number) => collection(name, filters, size),
});
function read(ref: any): any {
  if (ref.path) return { exists: records[ref.path] !== undefined, data: () => records[ref.path], ref };
  const docs = Object.entries(records).filter(([path, data]) => path.startsWith(`${ref.name}/`) && ref.filters.every(([key, value]: any) => data[key] === value))
    .slice(0, ref.maximum).map(([path, data]) => ({ id: path.split('/')[1], ref: { path }, data: () => data }));
  return { docs, size: docs.length };
}
const db = { collection, runTransaction: async (callback: any) => {
  const writes: any[] = [];
  const result = await callback({
    get: async (ref: any) => { if (writes.length) throw new Error('read-after-write'); return read(ref); },
    create: (ref: any, data: any) => { if (records[ref.path]) throw new Error('duplicate-create'); writes.push(['set', ref.path, data]); },
    set: (ref: any, data: any, options: any) => writes.push([options?.merge ? 'update' : 'set', ref.path, data]),
    update: (ref: any, data: any) => writes.push(['update', ref.path, data]),
    delete: (ref: any) => writes.push(['delete', ref.path]),
  });
  for (const [method, path, data] of writes) {
    if (method === 'delete') { delete records[path]; continue; }
    const value = method === 'update' ? { ...records[path] } : {};
    for (const [key, field] of Object.entries(data)) {
      if (field === undefined) throw new Error('undefined-write');
      if (key.includes('.')) { const [parent, child] = key.split('.'); value[parent] = { ...value[parent], [child]: field }; }
      else value[key] = field;
    }
    records[path] = value;
  }
  return result;
} } as unknown as Firestore;
const at = (time: string) => new Date(`2026-10-15T${time}:00+08:00`);
const input = { userId: 'member', storeId: 'lounge', requestId: 'request' };
const member = () => records['users/member'];
const sessionId = 'checkin_member_request';
const session = () => records[`visitSessions/${sessionId}`];

describe('managed lounge transactions', () => {
  beforeEach(() => {
    id = 0;
    records = {
      'users/member': { displayName: 'Member', status: 'active', role: 'member', membership: { points: 100, totalVisitHours: 0 } },
      'users/operator': { role: 'developer' },
      'users/otherStore': { role: 'storeAdmin', storeId: 'elsewhere' },
      'stores/lounge': { status: 'active', name: 'Lounge', operations: { ...emptyLoungeOperations(), enabled: true,
        week: Array.from({ length: 7 }, () => ({ open: true, startsAt: '12:00' })) } },
      'config/membershipFee': { annualFees: [{ startDate: Timestamp.fromDate(at('00:00')), rate: 20 }] },
      'config/points': { purchase: { rebatePercent: 0 } },
    };
  });
  it('checks hours and authorizes the member/store before writing', async () => {
    await expect(checkInLounge(db, 'member', input, at('11:59'))).rejects.toThrow('outside-hours');
    await expect(checkInLounge(db, 'member', input, at('23:00'))).rejects.toThrow('outside-hours');
    await expect(checkInLounge(db, 'otherStore', input, at('20:00'))).rejects.toThrow('forbidden');
    expect(member().membership.points).toBe(100);
  });
  it('charges first hour once and persists the cutoff', async () => {
    await checkInLounge(db, 'member', input, at('20:00'));
    await checkInLounge(db, 'member', input, at('20:00'));
    expect(member().membership.points).toBe(80);
    expect(session().scheduledCheckOutAt.toDate()).toEqual(at('23:00'));
    await expect(checkInLounge(db, 'member', { ...input, requestId: 'other' }, at('20:01'))).rejects.toThrow('already-checked-in');
  });
  it('closes to negative at 23:00 and does not debit again on retry or reload', async () => {
    member().membership.points = 30;
    await checkInLounge(db, 'member', input, at('20:00'));
    const first = await settleLoungeVisit(db, sessionId, at('23:05'), { automatic: true });
    expect(first.status).toBe('completed');
    expect(session().checkOutAt.toDate()).toEqual(at('23:00'));
    expect(member().membership.points).toBe(-40);
    member().membership.points += 200;
    await settleLoungeVisit(db, sessionId, at('23:10'), { uid: 'operator' });
    expect(member().membership.points).toBe(160);
    expect(member().membership.currentVisitSessionId).toBeNull();
    expect(Object.keys(records).filter(key => key.startsWith('pointsRecords/'))).toHaveLength(2);
  });
  it('preserves an earlier insufficient manual checkout and its requested time', async () => {
    member().membership.points = 20;
    await checkInLounge(db, 'member', input, at('20:00'));
    expect((await settleLoungeVisit(db, sessionId, at('21:20'), { uid: 'operator' })).status).toBe('insufficient');
    expect(session().status).toBe('pending');
    await settleLoungeVisit(db, sessionId, at('23:00'), { automatic: true });
    expect(session().checkOutAt.toDate()).toEqual(at('21:20'));
    expect(session().pointsDeducted).toBe(30);
    expect(member().membership.points).toBe(-10);
  });
  it('does not double charge paid realtime intervals', async () => {
    await checkInLounge(db, 'member', input, at('20:00'));
    await deductLoungeRealtime(db, sessionId, 'member', at('22:59'));
    expect(member().membership.points).toBe(40);
    await settleLoungeVisit(db, sessionId, at('23:00'), { automatic: true });
    expect(member().membership.points).toBe(30);
    expect(member().membership.totalVisitHours).toBe(3.5);
  });
  it('previews without writing, preserves pending cigar choices on close', async () => {
    await checkInLounge(db, 'member', input, at('20:00'));
    const before = Object.keys(records).length;
    expect((await settleLoungeVisit(db, sessionId, at('23:00'), { automatic: true, preview: true })).status).toBe('preview');
    expect(Object.keys(records)).toHaveLength(before);
    records[`redemptionRecords/${sessionId}`] = { redemptions: [{ status: 'pending', quantity: 1, cigarId: '' }] };
    await settleLoungeVisit(db, sessionId, at('23:00'), { automatic: true });
    expect(records[`redemptionRecords/${sessionId}`].redemptions[0].status).toBe('pending');
    expect(Object.keys(records).some(key => key.startsWith('inventory_movements/'))).toBe(false);
  });
});
