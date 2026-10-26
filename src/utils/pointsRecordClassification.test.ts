import { describe, expect, it } from 'vitest';
import { classifyPointsRecord } from './pointsRecordClassification';
describe('shared point record calculation classification', () => {
  it.each([
    { migration: { source: 'legacy_workbook' } }, { migration: { balanceNotApplied: true } },
    { createdBy: 'legacy_migration' }, { description: 'Historical visit fee import' },
  ])('retains historical evidence without applying it again: %j', record => {
    expect(classifyPointsRecord(record)).toBe('historical');
  });
  it('never uses the cosmetic H suffix alone as authority to exclude a transaction', () => {
    expect(classifyPointsRecord({ description: 'Actual charge (H)' })).toBe('transaction');
  });
  it('distinguishes a cumulative summary from an actual ledger change', () => {
    expect(classifyPointsRecord({ isVisitSessionSummary: true })).toBe('summary');
    expect(classifyPointsRecord({ description: 'Visit final settlement' })).toBe('transaction');
  });
});
