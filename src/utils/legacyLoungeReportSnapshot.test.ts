import { describe, expect, it } from 'vitest';
import { correctLegacyLoungeDebtDetails } from './legacyLoungeReportSnapshot';
import type { LoungeDebtDetails } from '../types/loungeReport';

const fixture = (): LoungeDebtDetails => ({ businessDate: '2026-10-27', from: '2026-10-26T16:00:00Z',
  to: '2026-10-26T16:15:00Z', historical: false, otherReviewCount: 0, truncated: false,
  customers: [{ userId: 'member', name: 'Member', memberId: 'MEM', reliable: false,
    reasons: ['wallet-mismatch', 'missing-checkpoint'], walletBalance: 19, opening: null, added: null,
    repaid: null, outstanding: null, entryCount: 0, entries: [] }] });
describe('legacy report correction from saved evidence only', () => {
  it('removes the unsupported mismatch without inventing history, debt or an opening balance', () => {
    const source = fixture(), frozen = JSON.stringify(source), result = correctLegacyLoungeDebtDetails(source);
    expect(JSON.stringify(source)).toBe(frozen);
    expect(result.customers[0]).toMatchObject({ reasons: ['missing-checkpoint'], walletBalance: 19,
      expectedBalance: null, difference: null, reliable: false, outstanding: null, entryCount: 0, entries: [] });
    expect(result.legacyCorrection).toBe('saved-evidence-only');
    expect(result.to).toBe(source.to);
    expect(correctLegacyLoungeDebtDetails(result)).toBe(result);
  });
  it('retains a real computed discrepancy and other review reasons', () => {
    const source = fixture(); source.customers[0].expectedBalance = 37;
    expect(correctLegacyLoungeDebtDetails(source)).toBe(source);
    delete source.customers[0].expectedBalance;
    source.customers[0].reasons = ['wallet-mismatch', 'balance-gap'];
    expect(correctLegacyLoungeDebtDetails(source)).toBe(source);
  });
  it.each([2, 3])('leaves schema %s snapshots unchanged', schemaVersion => {
    const source = { ...fixture(), schemaVersion };
    expect(correctLegacyLoungeDebtDetails(source)).toBe(source);
  });
});
