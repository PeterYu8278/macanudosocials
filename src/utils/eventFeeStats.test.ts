import { describe, expect, it } from 'vitest';
import { calculateEventFeeStats } from './eventFeeStats';

describe('calculateEventFeeStats', () => {
  it('charges the default fee for registered participants without allocations', () => {
    expect(calculateEventFeeStats({
      participants: {
        registered: ['member-1', 'member-2'],
        fee: 500,
      },
      allocations: {
        'member-2': { feeQuantity: 1, feeUnitPrice: 500 },
      },
    })).toEqual({
      payerCount: 2,
      feeQuantity: 2,
      feeUnit: 500,
      feeTotal: 1000,
    });
  });

  it('uses a participant allocation when quantity and price are customized', () => {
    expect(calculateEventFeeStats({
      participants: {
        registered: ['member-1'],
        fee: 500,
      },
      allocations: {
        'member-1': { feeQuantity: 2, feeUnitPrice: 300 },
      },
    }).feeTotal).toBe(600);
  });

  it('does not count a participant whose custom fee is zero', () => {
    expect(calculateEventFeeStats({
      participants: {
        registered: ['member-1'],
        fee: 500,
      },
      allocations: {
        'member-1': { feeQuantity: 1, feeUnitPrice: 0 },
      },
    })).toMatchObject({
      payerCount: 0,
      feeQuantity: 0,
      feeTotal: 0,
    });
  });
});
