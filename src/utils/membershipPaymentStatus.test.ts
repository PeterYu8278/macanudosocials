import { describe, expect, it } from 'vitest';
import { membershipPaymentStatusData } from './membershipPaymentStatus';

describe('public payment status projection', () => {
  it('exposes only member-safe fields and omits undefined values', () => {
    expect(membershipPaymentStatusData({ userId: 'owner', status: 'pending', totalCents: 29900,
      paymentMethod: 'manual', callbackProof: 'secret', apiKey: 'secret', billId: 'bill',
      paymentUrl: 'private', annualFee: undefined, unexpected: 'private' })).toEqual({
      userId: 'owner', status: 'pending', totalCents: 29900, paymentMethod: 'manual',
    });
  });
});
