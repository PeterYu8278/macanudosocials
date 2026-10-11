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
  it('lets verified first-time status override local dates', () => {
    expect(getMembershipEntryAction({ ...account, quote: { renewal: false, annualFee: 199 } }, now)).toBe('join');
  });
  it('shows Join Now immediately without waiting for a quote', () => {
    expect(getMembershipEntryAction({ status: 'inactive', points: 0, annualFee: null }, now)).toBe('join');
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
    expect(getMembershipEntryAction({ ...account, status: 'active' }, now)).toBe('reload');
    expect(getMembershipEntryAction({ ...account, activeUntil: new Date('2027-01-01') }, now)).not.toBe('active');
  });
  it('recognizes an active unexpired pass', () => {
    expect(getMembershipEntryAction({ ...account, status: 'active', activeUntil: new Date('2027-01-01') }, now)).toBe('active');
  });
  it('keeps renewal available for backend verification when the fee is unknown', () => {
    expect(getMembershipEntryAction({ ...account, annualFee: null }, now)).toBe('renew');
    expect(getMembershipEntryAction({ ...account, annualFee: NaN }, now)).toBe('renew');
  });
  it('does not classify isolated or reversed dates as renewal', () => {
    expect(getMembershipEntryAction({ ...account, activeFrom: undefined }, now)).toBe('join');
    expect(getMembershipEntryAction({ ...account, activeUntil: undefined }, now)).toBe('join');
    expect(getMembershipEntryAction({ ...account, activeFrom: account.activeUntil, activeUntil: account.activeFrom }, now)).toBe('join');
  });
  it('uses a first activation timestamp as a display hint, not an authorization', () => {
    const input = { status: 'inactive', points: 0, annualFee: 199, firstActivatedAt: account.activeFrom };
    expect(getMembershipEntryAction(input, now)).toBe('reload');
    expect(getMembershipEntryAction({ ...input, quote: { renewal: false, annualFee: 199 } }, now)).toBe('join');
    expect(getMembershipEntryAction({ ...input, firstActivatedAt: new Date('2027-01-01') }, now)).toBe('join');
  });
  it('uses the confirmed fee instead of a stale local fee', () => {
    expect(getMembershipEntryAction({ ...account, points: 199, annualFee: 100, quote: { renewal: true, annualFee: 200 } }, now)).toBe('reload');
  });
});
