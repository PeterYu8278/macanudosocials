import { describe, expect, it } from 'vitest';
import { loungeDailyPaymentStats } from './loungeDailyPaymentStats';

const start = Date.parse('2026-10-24T16:00:00Z'), end = start + 86400000;
const at = new Date(start + 3600000);
const reload = (extra = {}) => ({ storeId: 'lounge', userId: 'member', status: 'completed',
  requestedAmount: 200, verifiedAt: at, ...extra });
const activation = (extra = {}) => ({ storeId: 'lounge', userId: 'member', status: 'paid',
  renewalType: 'initial', deductedAt: at, ...extra });

describe('daily lounge payment statistics', () => {
  it('separates package annual fees, counts repeated payments and deduplicates people', () => {
    const result = loungeDailyPaymentStats([
      reload({ requestedAmount: 299, annualFeeAmount: 199, pointsEquivalent: 100 }),
      reload({ actualAmount: 150, pointsEquivalent: 175 }),
      reload({ userId: 'other', requestedAmount: 0.1 }),
      reload({ userId: 'other', requestedAmount: 0.2 }),
    ], [activation(), activation(), activation({ renewalType: 'renewal', userId: 'renewal' })], 'lounge', start, end, end);
    expect(result).toEqual({ payments: 4, customers: 2, received: 449.3, reloadAmount: 250.3,
      annualFees: 199, newMembers: 1 });
  });
  it('uses confirmation time in MYT, limits test snapshots and excludes other lounges and unconfirmed payments', () => {
    const rows = [reload({ verifiedAt: new Date(start) }),
      ...['pending', 'rejected'].map(status => reload({ status })), reload({ storeId: 'other' }),
      reload({ verifiedAt: new Date(start - 1) }), reload({ verifiedAt: new Date(end) }),
      reload({ verifiedAt: undefined }), reload({ verifiedAt: new Date(start + 2) })];
    const fees = [activation({ deductedAt: new Date(start) }), activation({ status: 'pending', userId: 'pending' }),
      activation({ storeId: 'other', userId: 'other' }), activation({ deductedAt: new Date(end), userId: 'later' })];
    expect(loungeDailyPaymentStats(rows, fees, 'lounge', start, end, start + 1))
      .toEqual({ payments: 1, customers: 1, received: 200, reloadAmount: 200, annualFees: 0, newMembers: 1 });
  });
  it('returns explicit zeros on a quiet day', () => {
    expect(loungeDailyPaymentStats([], [], 'lounge', start, end, end))
      .toEqual({ payments: 0, customers: 0, received: 0, reloadAmount: 0, annualFees: 0, newMembers: 0 });
  });
  it.each([{ requestedAmount: NaN }, { annualFeeAmount: 201 }, { actualAmount: -1 }])('rejects invalid receipts instead of silently reporting incorrect money: %o', extra => {
    expect(() => loungeDailyPaymentStats([reload(extra)], [], 'lounge', start, end, end)).toThrow('invalid-report-payment-amount');
  });
});
