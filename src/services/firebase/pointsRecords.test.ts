import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ list: [] as any[], full: [] as any[], fail: false, getDocs: vi.fn(), addDoc: vi.fn() }));
vi.mock('../../config/firebase', () => ({ db: {} }));
vi.mock('./auditLog', () => ({ saveAuditLog: vi.fn() }));
vi.mock('@/services/firebase/monitoredFirestore', () => ({
  collection: (_: unknown, name: string) => ({ name }),
  where: (field: string, op: string, value: unknown) => ({ field, op, value }),
  orderBy: () => ({}), limit: (count: number) => ({ count }),
  query: (collection: object, ...filters: any[]) => ({ ...collection, filters }),
  getDocs: m.getDocs, addDoc: m.addDoc, Timestamp: { fromDate: (date: Date) => date },
}));
import { getUserPointsRecords } from './pointsRecords';
describe('complete session cards from a limited point history', () => {
  beforeEach(() => {
    vi.clearAllMocks(); m.fail = false;
    m.full = [
      { id: 'closing', userId: 'member', source: 'visit', relatedId: 'session', type: 'spend', amount: 81,
        description: 'Visit final settlement', createdAt: new Date('2026-10-23T15:00:00Z') },
      { id: 'first', userId: 'member', source: 'visit', relatedId: 'session', type: 'spend', amount: 18,
        description: 'Visit first-hour charge', createdAt: new Date('2026-10-23T09:35:00Z') },
    ];
    m.list = [m.full[0]];
    m.getDocs.mockImplementation(async q => {
      if (q.name === 'visitSessions') return { docs: [], size: 0 };
      const sessionLookup = q.filters.some((filter: any) => filter.field === 'relatedId');
      if (sessionLookup && m.fail) throw new Error('permission-denied');
      const rows = sessionLookup ? m.full : m.list;
      return { docs: rows.map(row => ({ id: row.id, data: () => row })), size: rows.length };
    });
  });
  it('loads the first-hour charge beyond the initial list limit before displaying the 99-point session total', async () => {
    const records = await getUserPointsRecords('member', 1);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ amount: 99, visitRecordsComplete: true, visitDisplaySummary: true });
    expect(records[0].visitBreakdown).toHaveLength(2);
    const lookup = m.getDocs.mock.calls.find(([q]) => q.filters.some((filter: any) => filter.field === 'relatedId'))?.[0];
    expect(lookup.filters).toEqual(expect.arrayContaining([{ field: 'userId', op: '==', value: 'member' }, { field: 'relatedId', op: '==', value: 'session' }]));
    expect(m.addDoc).not.toHaveBeenCalled();
  });
  it('marks failed lookups incomplete so the UI can hide a misleading partial net amount', async () => {
    m.fail = true;
    const records = await getUserPointsRecords('member', 1);
    expect(records).toHaveLength(1);
    expect(records[0].visitRecordsComplete).toBe(false);
  });
  it('does not claim a complete total when a previously listed charge disappears during hydration', async () => {
    m.full = [];
    expect((await getUserPointsRecords('member', 1))[0].visitRecordsComplete).toBe(false);
  });
});
