import { describe, expect, it } from 'vitest';
import { refreshLoungeDebtHistory, type ArchivedLedgerSource } from './refreshLoungeDebtHistory';
import type { LoungeDebtDetails } from '../types/loungeReport';
const fixture = (): LoungeDebtDetails => ({ businessDate: '2026-10-27', from: new Date(5000).toISOString(),
  to: new Date(6000).toISOString(), historical: false, otherReviewCount: 0, truncated: false,
  customers: [{ userId: 'member', name: 'Member', memberId: 'MEM', reliable: false, reasons: ['missing-checkpoint'],
    walletBalance: 19, opening: null, added: null, repaid: null, outstanding: null, entryCount: 0, entries: [] }] });
const sources = (): ArchivedLedgerSource[] => [100, -18, -27, -36].map((amount, i) => ({ id: `entry-${i}`, createdAt: 1000, updatedAt: 1000,
  record: { id: `entry-${i}`, userId: 'member', source: i === 0 ? 'reload' : 'visit', type: amount < 0 ? 'spend' : 'earn',
    at: 2000 + i * 100, amount, createdBy: 'legacy_migration', storeId: 'lounge' } }));
describe('historical debt snapshot reconstruction', () => {
  it('uses original cutoff and wallet, restores historical evidence and calculated balances, and never mutates inputs', () => {
    const original = fixture(), frozen = JSON.stringify(original), result = refreshLoungeDebtHistory(original, 'lounge', sources(), 'now')!;
    expect(result.to).toBe(original.to); expect(JSON.stringify(original)).toBe(frozen);
    expect(result.customers[0]).toMatchObject({ reliable: true, walletBalance: 19, expectedBalance: 19, difference: 0, entryCount: 4 });
    expect(result.customers[0].entries[0]).toMatchObject({ id: 'entry-3', before: null, after: null, calculatedBefore: 55, calculatedAfter: 19 });
  });
  it('does not include later-created or future-dated transactions', () => {
    const rows = sources(); rows.push({ ...rows[0], id: 'late', createdAt: 7000, updatedAt: 7000, record: { ...rows[0].record, amount: 999 } });
    rows.push({ ...rows[0], id: 'future', record: { ...rows[0].record, at: 7000, amount: 999 } });
    expect(refreshLoungeDebtHistory(fixture(), 'lounge', rows, 'now')!.customers[0]).toMatchObject({ reliable: true, expectedBalance: 19, entryCount: 4 });
  });
  it('preserves a customer when source data changed after the snapshot', () => {
    const original = fixture(), rows = sources(); rows[0].updatedAt = 7000;
    const result = refreshLoungeDebtHistory(original, 'lounge', rows, 'now')!;
    expect(result.customers[0]).toBe(original.customers[0]); expect(result.historyRefresh.skippedCustomers).toBe(1);
  });
  it('retains real mismatches rather than forcing saved wallets to the historical sum', () => {
    const original = fixture(); original.customers[0].walletBalance = 20;
    expect(refreshLoungeDebtHistory(original, 'lounge', sources(), 'now')!.customers[0])
      .toMatchObject({ reliable: false, expectedBalance: 19, difference: 1, reasons: ['wallet-mismatch'], outstanding: null });
  });
  it('fills a previously truncated zero-origin history beyond the old 20-entry limit', () => {
    const original = fixture(); original.balanceOrigin = 'zero'; original.truncated = true; original.customers[0].walletBalance = 25;
    const rows = Array.from({ length: 25 }, (_, i) => ({ ...sources()[0], id: `row${i}`, record: { ...sources()[0].record, at: 2000 + i, amount: 1 } }));
    const result = refreshLoungeDebtHistory(original, 'lounge', rows, 'now')!;
    expect(result.customers[0].entries).toHaveLength(25); expect(result.truncated).toBe(false); expect(result.customers[0].reliable).toBe(true);
  });
  it('refuses to reconstruct snapshots with no saved customer scope', () => {
    expect(refreshLoungeDebtHistory({ ...fixture(), customers: [] }, 'lounge', sources(), 'now')).toBeNull();
  });
});
