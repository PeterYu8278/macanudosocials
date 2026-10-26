import { describe, expect, it } from 'vitest';
import { reconcileLoungeDebt, type DebtBaseline } from './loungeDebt';
describe('shared-wallet debt attribution', () => {
  const baseline = (balance = 156): DebtBaseline => ({ version: 1, at: 1, balance, boundary: 'through_timestamp',
    evidenceReference: 'verified-archive', note: 'Reviewed independent historical source', reviewedBy: 'reviewer', approvedAt: 2 });
  it('does not label absence of usable history as an established wallet discrepancy', () => {
    expect(reconcileLoungeDebt([], 2, 5, 156)).toMatchObject({ reliable: false, reasons: ['missing-checkpoint'], expectedBalance: null, difference: null });
  });
  it('starts from an approved historical balance and never applies records covered by its boundary again', () => {
    const result = reconcileLoungeDebt([
      { id: 'covered', at: 1, amount: 999, after: 999 },
      { id: 'new', at: 3, amount: -160, before: 156, after: -4, storeId: 'A' },
    ], 2, 5, -4, baseline());
    expect(result).toMatchObject({ reliable: true, expectedBalance: -4, difference: 0, added: { A: 4 }, closing: { A: 4 } });
  });
  it('retains negative historical baseline debt as unallocated and applies FIFO repayments', () => {
    const result = reconcileLoungeDebt([{ id: 'reload', at: 3, amount: 10, before: -20, after: -10, storeId: 'B' }], 2, 5, -10, baseline(-20));
    expect(result).toMatchObject({ reliable: true, opening: { unallocated: 20 }, repaid: { unallocated: 10 }, closing: { unallocated: 10 } });
    expect(result.closing.A).toBeUndefined();
  });
  it('orders same-time membership fees and credits by their balance chain, not document ID', () => {
    const result = reconcileLoungeDebt([
      { id: 'a-fee', at: 3, amount: -199, before: 299, after: 100 },
      { id: 'z-credit', at: 3, amount: 299, before: 0, after: 299 },
    ], 2, 5, 100);
    expect(result).toMatchObject({ reliable: true, expectedBalance: 100, reasons: [] });
  });
  it('does not guess the order of ambiguous same-time transactions', () => {
    const result = reconcileLoungeDebt([{ id: 'a', at: 3, amount: -10 }, { id: 'b', at: 3, amount: -20 }], 2, 5, -30);
    expect(result.reliable).toBe(false); expect(result.reasons).toContain('ambiguous-order');
  });
  it('does not claim a complete period when the baseline is later than its opening', () => {
    expect(reconcileLoungeDebt([], 0, 5, 156, baseline()).reasons).toContain('baseline-after-opening');
  });
  it('refuses a baseline without independent evidence', () => {
    expect(reconcileLoungeDebt([], 2, 5, 156, { ...baseline(), evidenceReference: '' }).reasons).toContain('invalid-baseline');
  });
  it('flags invalid dates instead of dropping the transaction silently', () => {
    expect(reconcileLoungeDebt([{ id: 'bad', at: NaN, amount: 10 }], 2, 5, 156, baseline()).reasons).toContain('invalid-entry');
  });
  it('separates historical opening debt, new debt and FIFO repayments across stores', () => {
    const result = reconcileLoungeDebt([
      { id: '1', at: 1, amount: -30, before: 10, after: -20, storeId: 'A' },
      { id: '2', at: 3, amount: -10, before: -20, after: -30, storeId: 'B' },
      { id: '3', at: 4, amount: 25, before: -30, after: -5 },
    ], 2, 5, -5);
    expect(result).toMatchObject({ reliable: true, opening: { A: 20 }, added: { B: 10 }, repaid: { A: 20, B: 5 }, closing: { B: 5 } });
  });
  it('keeps pre-checkpoint negative balances unallocated', () => {
    expect(reconcileLoungeDebt([{ id: '1', at: 3, amount: -10, before: -20, after: -30, storeId: 'A' }], 2, 5, -30))
      .toMatchObject({ reliable: true, opening: { unallocated: 20 }, added: { A: 10 }, closing: { unallocated: 20, A: 10 } });
  });
  it('does not fabricate zero debt when checkpoints or ledger entries are missing', () => {
    expect(reconcileLoungeDebt([], 2, 5, -20).reliable).toBe(false);
    expect(reconcileLoungeDebt([{ id: '1', at: 3, amount: -10, before: 20, after: 10 }], 2, 5, -50).reliable).toBe(false);
  });
  it('flags balance gaps instead of attributing them to a lounge', () => {
    expect(reconcileLoungeDebt([
      { id: '1', at: 1, amount: -5, before: 0, after: -5, storeId: 'A' },
      { id: '2', at: 3, amount: -5, before: -50, after: -55, storeId: 'B' },
    ], 2, 5, -55).reliable).toBe(false);
  });
});
