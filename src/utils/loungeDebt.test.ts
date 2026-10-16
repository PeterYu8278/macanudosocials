import { describe, expect, it } from 'vitest';
import { reconcileLoungeDebt } from './loungeDebt';
describe('shared-wallet debt attribution', () => {
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
