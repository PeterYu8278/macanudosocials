import { describe, expect, it } from 'vitest';
import { getMembershipEntryAction } from './membershipEntry';

const now = new Date('2026-10-11T00:00:00Z');
const account = { status: 'inactive', points: 102, activeFrom: new Date('2024-01-01'), activeUntil: new Date('2025-01-01'), annualFee: 199 };
describe('membership entry button', () => {
  it('uses account dates and points to show reload without a quote', () => {
    expect(getMembershipEntryAction(account, now)).toBe('reload');
  });
  it('shows renewal instead of Join Now when the balance covers the fee', () => {
    expect(getMembershipEntryAction({ ...account, points: 199 }, now)).toBe('renew');
  });
  it('keeps the reload button when the quote fails but account history is known', () => {
    expect(getMembershipEntryAction({ ...account, queryFailed: true }, now)).toBe('reload');
  });
  it('does not mistake missing dates for first activation before checking history', () => {
    expect(getMembershipEntryAction({ status: 'inactive', points: 102, annualFee: 199 }, now)).toBe('checking');
  });
  it('uses the quote to distinguish legacy history from first activation', () => {
    const input = { status: 'inactive', points: 102, annualFee: 199 };
    expect(getMembershipEntryAction({ ...input, quote: { renewal: true, annualFee: 199 } }, now)).toBe('reload');
    expect(getMembershipEntryAction({ ...input, quote: { renewal: false, annualFee: 199 } }, now)).toBe('join');
  });
  it('preserves existing payment continuation', () => {
    expect(getMembershipEntryAction({ ...account, quote: { renewal: true, pending: true, annualFee: 199 } }, now)).toBe('resume');
  });
  it('blocks suspended accounts', () => {
    expect(getMembershipEntryAction({ ...account, status: 'suspended' }, now)).toBe('blocked');
  });
  it('checks conflicting status and dates rather than treating an expired pass as active', () => {
    expect(getMembershipEntryAction({ ...account, status: 'active' }, now)).toBe('checking');
    expect(getMembershipEntryAction({ ...account, activeUntil: new Date('2027-01-01') }, now)).toBe('checking');
    expect(getMembershipEntryAction({ ...account, activeUntil: new Date('2027-01-01'), queryFailed: true }, now)).toBe('error');
  });
  it('recognizes an active unexpired pass', () => {
    expect(getMembershipEntryAction({ ...account, status: 'active', activeUntil: new Date('2027-01-01') }, now)).toBe('active');
  });
  it('waits for a valid fee instead of guessing a reload requirement', () => {
    expect(getMembershipEntryAction({ ...account, annualFee: null }, now)).toBe('checking');
    expect(getMembershipEntryAction({ ...account, annualFee: NaN }, now)).toBe('checking');
  });
  it('requires verification for missing history when the lookup fails', () => {
    expect(getMembershipEntryAction({ status: 'inactive', points: 102, annualFee: 199, queryFailed: true }, now)).toBe('error');
  });
});
