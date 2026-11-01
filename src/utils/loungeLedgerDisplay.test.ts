import { describe, expect, it } from 'vitest';
import { groupLoungeLedgerEntries } from './loungeLedgerDisplay';
import type { LoungeDebtCustomer } from '../types/loungeReport';
type Entry = LoungeDebtCustomer['entries'][number];
const entry = (id: string, at: number, amount: number, description: string, extra: Partial<Entry> = {}): Entry => ({
  id, at: new Date(at * 1000).toISOString(), amount, description, before: null, after: null,
  source: 'visit', relatedId: 'session', local: true, participation: 'included', ...extra,
});
describe('saved lounge ledger presentation', () => {
  it('combines all visit stages and rebates without mutating evidence or losing references', () => {
    const rows = [entry('final', 4, -72, 'Visit final settlement', { after: 10, calculatedAfter: 10 }),
      entry('rebate', 3, 5, 'Visit rebate'), entry('interval', 2, -9, 'Visit interval charge'),
      entry('first', 1, -18, 'Visit first-hour charge', { before: 104, calculatedBefore: 104 })];
    const before = JSON.stringify(rows), result = groupLoungeLedgerEntries(rows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ amount: -94, before: 104, after: 10, calculatedBefore: 104, calculatedAfter: 10,
      visitGroup: true, interleaved: false, ledgerIds: ['first', 'interval', 'rebate', 'final'] });
    expect(JSON.stringify(rows)).toBe(before);
  });
  it('keeps intervening reloads separate and does not invent net before/after balances', () => {
    const result = groupLoungeLedgerEntries([entry('first', 1, -18, 'Visit first-hour charge', { before: 52, after: 34 }),
      entry('reload', 2, 200, 'Verified manual payment', { source: 'reload', relatedId: 'payment', after: 234 }),
      entry('final', 3, -72, 'Visit final settlement', { before: 234, after: 162 })]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ amount: -90, before: null, after: null, interleaved: true });
    expect(result[0].calculatedBefore).toBeUndefined();
    expect(result[1].id).toBe('reload');
  });
  it('keeps sessions, excluded summaries and missing references separate', () => {
    expect(groupLoungeLedgerEntries([entry('a', 1, -18, 'Visit first-hour charge'),
      entry('b', 2, -18, 'Visit first-hour charge', { relatedId: 'other' }),
      entry('c', 3, -18, 'Visit final settlement', { participation: 'summary' }),
      entry('d', 4, -18, 'Visit final settlement', { relatedId: '' })])).toHaveLength(4);
  });
  it('does not invent ordering for simultaneous stages or discard zero settlements', () => {
    const rows = groupLoungeLedgerEntries([entry('a', 1, -18, 'Visit first-hour charge'), entry('b', 1, 0, 'Visit final settlement')]);
    expect(rows[0]).toMatchObject({ amount: -18, interleaved: true });
    expect(rows[0].ledgerIds).toHaveLength(2);
  });
});
