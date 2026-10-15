import { describe, expect, it } from 'vitest';
import { netReloadPoints, netReloadPointsMigration } from './reloadPoints';

describe('net reload points', () => {
  it('converts legacy gross points using the recorded fee', () => {
    expect(netReloadPoints({ pointsEquivalent: 299, annualFeeAmount: 199 })).toBe(100);
  });
  it('never deducts the fee twice from new records', () => {
    expect(netReloadPoints({ pointsEquivalent: 100, annualFeeAmount: 199, pointsEquivalentBasis: 'net' })).toBe(100);
  });
  it('allows renewal fees to use the existing wallet balance', () => {
    expect(netReloadPoints({ pointsEquivalent: -99, annualFeeAmount: 199, pointsEquivalentBasis: 'net' })).toBe(-99);
  });
  it('does not invent a missing historical fee', () => {
    expect(netReloadPoints({ pointsEquivalent: 200 })).toBe(200);
  });
  it('migrates once while preserving the original gross value', () => {
    const record = { status: 'completed', pointsEquivalent: 299, annualFeeAmount: 199 };
    const update = netReloadPointsMigration(record);
    expect(update).toEqual({ pointsEquivalent: 100, pointsEquivalentBasis: 'net', legacyGrossPointsEquivalent: 299 });
    expect(netReloadPointsMigration({ ...record, ...update })).toBeNull();
  });
  it('skips pending payments and annual payments without fee evidence', () => {
    expect(netReloadPointsMigration({ status: 'pending', pointsEquivalent: 299, annualFeeAmount: 199 })).toBeNull();
    expect(netReloadPointsMigration({ status: 'completed', pointsEquivalent: 299, membershipOrderId: 'order' })).toBeNull();
  });
  it('migrates ordinary historical reloads without inventing annual deductions', () => {
    expect(netReloadPointsMigration({ status: 'completed', pointsEquivalent: 200 })).toMatchObject({ pointsEquivalent: 200 });
  });
  it('rejects invalid gross or fee values', () => {
    expect(netReloadPointsMigration({ status: 'completed', pointsEquivalent: NaN })).toBeNull();
    expect(netReloadPointsMigration({ status: 'completed', pointsEquivalent: 299, annualFeeAmount: -1 })).toBeNull();
  });
});
