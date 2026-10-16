// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
const mocks = vi.hoisted(() => ({ settle: vi.fn(), stock: vi.fn(), pages: vi.fn(), report: vi.fn(), send: vi.fn() }));
vi.mock('../functions/_shared/loungeVisits', () => ({
  settleLoungeVisit: mocks.settle, syncLoungeRedemptions: mocks.stock,
  asDate: (value: any) => value?.toDate?.() || new Date(value), loungeError: (code: string) => new Error(code),
}));
vi.mock('../functions/_shared/loungeDailyReport', () => ({ readPaged: mocks.pages, createLoungeReport: mocks.report, sendLoungeReport: mocks.send }));
import { closingRound, runLoungeClosing } from '../functions/_shared/loungeClosing';
const now = (minute: number) => new Date(`2026-10-15T23:${String(minute).padStart(2, '0')}:00+08:00`);
let records: Record<string, any>, pending: boolean;
const collection = (name: string, filters: any[] = []): any => ({ name, filters,
  doc: (id: string) => { const path = `${name}/${id}`; return { id, path, get: async () => ({ data: () => records[path] }) }; },
  where: (field: string, _op: string, value: any) => collection(name, [...filters, [field, value]]), orderBy: () => collection(name, filters),
});
const db = { collection, runTransaction: async (callback: any) => callback({
  get: async (ref: any) => ({ data: () => records[ref.path] }),
  set: (ref: any, data: any) => { records[ref.path] = { ...records[ref.path], ...data }; },
  update: (ref: any, data: any) => { records[ref.path] = { ...records[ref.path], ...data }; },
}) } as unknown as Firestore;
describe('three-round lounge closing batches', () => {
  beforeEach(() => {
    vi.resetAllMocks(); pending = true;
    records = { 'stores/lounge': { operations: { enabled: true } } };
    mocks.pages.mockImplementation(async (query: any) => query.filters.some(([field]: any) => field === 'inventorySettlementStatus') ? [] : pending ? [{
      id: 'session', data: () => ({ checkInAt: Timestamp.fromDate(new Date('2026-10-15T12:00:00+08:00')) }),
    }] : []);
    mocks.settle.mockImplementation(async () => { pending = false; return { status: 'completed' }; });
    mocks.report.mockResolvedValue({ id: 'report' });
  });
  it('uses exactly the three configured five-minute rounds', () => {
    expect(closingRound(new Date('2026-10-15T22:59:00+08:00'))).toBe(0);
    expect([0, 4, 5, 9, 10, 50].map(m => closingRound(now(m)))).toEqual([1, 1, 2, 2, 3, 3]);
  });
  it('exits financial processing after successful completion', async () => {
    expect((await runLoungeClosing(db, 'lounge', now(0))).status).toBe('completed');
    await runLoungeClosing(db, 'lounge', now(5)); await runLoungeClosing(db, 'lounge', now(10));
    expect(mocks.settle).toHaveBeenCalledTimes(1);
  });
  it('waits for later rounds and reports unresolved work after round three', async () => {
    mocks.settle.mockRejectedValue(new Error('failure'));
    expect((await runLoungeClosing(db, 'lounge', now(0))).status).toBe('waiting');
    expect(mocks.report).not.toHaveBeenCalled();
    await runLoungeClosing(db, 'lounge', now(5));
    expect((await runLoungeClosing(db, 'lounge', now(10))).status).toBe('incomplete');
    expect(mocks.settle).toHaveBeenCalledTimes(3);
    expect(mocks.report).toHaveBeenCalledTimes(1);
  });
  it('does not re-enter checkout if report submission fails', async () => {
    mocks.send.mockRejectedValueOnce(new Error('provider-offline'));
    await expect(runLoungeClosing(db, 'lounge', now(0))).rejects.toThrow('provider-offline');
    await runLoungeClosing(db, 'lounge', now(5));
    expect(mocks.settle).toHaveBeenCalledTimes(1);
  });
  it('does not overlap a live batch lease', async () => {
    records['_loungeClosingBatches/lounge_2026-10-15'] = { leaseUntil: Timestamp.fromMillis(Date.now() + 10000) };
    await expect(runLoungeClosing(db, 'lounge', now(0))).rejects.toThrow('busy');
    expect(mocks.settle).not.toHaveBeenCalled();
  });
});
