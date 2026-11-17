import { describe, expect, it } from 'vitest';
import { walletLedgerTreatments } from './walletLedgerEvidence';
describe('read-only historical ledger participation', () => {
  it('includes imported history even when import did not apply another wallet write', () => {
    expect(walletLedgerTreatments([{ id: 'history', migration: { source: 'legacy_workbook', balanceNotApplied: true } }]).get('history'))
      .toBe('historical-included');
  });
  it('excludes summaries and prefers linked actual transactions over historical duplicates', () => {
    const base = { userId: 'member', source: 'visit', relatedId: 'session', type: 'spend' };
    const result = walletLedgerTreatments([{ ...base, id: 'import', createdBy: 'legacy_migration' },
      { ...base, id: 'first-hour' }, { ...base, id: 'closing' }, { ...base, id: 'summary', isVisitSessionSummary: true }]);
    expect([...result]).toEqual([['import', 'duplicate'], ['first-hour', 'included'], ['closing', 'included'], ['summary', 'summary']]);
  });
  it('keeps unrelated histories, rebates and different users distinct', () => {
    const result = walletLedgerTreatments([{ id: 'history', userId: 'A', source: 'visit', relatedId: 'same', type: 'spend', createdBy: 'legacy_migration' },
      { id: 'other-user', userId: 'B', source: 'visit', relatedId: 'same', type: 'spend' },
      { id: 'rebate', userId: 'A', source: 'visit', relatedId: 'same', type: 'earn' }]);
    expect(result.get('history')).toBe('historical-included');
  });
  it('does not allow a display summary alone to suppress real historical evidence', () => {
    const base = { userId: 'member', source: 'visit', relatedId: 'session', type: 'spend' };
    expect(walletLedgerTreatments([{ ...base, id: 'history', createdBy: 'legacy_migration' },
      { ...base, id: 'summary', isVisitSessionSummary: true }]).get('history')).toBe('historical-included');
  });
});
