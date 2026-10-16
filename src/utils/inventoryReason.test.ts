import { describe, expect, it } from 'vitest';
import { formatInventoryReason, visitRedemptionStockOutReason } from './inventoryReason';

describe('English visit redemption stock-out reasons', () => {
  it('writes a fixed English reason while retaining the session ID', () => {
    expect(visitRedemptionStockOutReason('session-123')).toBe('Visit session redemption stock-out (Session: session-123)');
  });

  it('displays legacy Chinese reasons in English without changing their session reference', () => {
    expect(formatInventoryReason('驻店兑换出库 (Session: Yrd2WSwgX3IEdRrqP3BF)'))
      .toBe('Visit session redemption stock-out (Session: Yrd2WSwgX3IEdRrqP3BF)');
    expect(formatInventoryReason('驻店兑换出库')).toBe('Visit session redemption stock-out');
  });

  it('leaves English reasons and other user notes unchanged', () => {
    const reason = visitRedemptionStockOutReason('session-123');
    expect(formatInventoryReason(reason)).toBe(reason);
    expect(formatInventoryReason('Custom stock adjustment')).toBe('Custom stock adjustment');
    expect(formatInventoryReason('驻店兑换出库异常备注')).toBe('驻店兑换出库异常备注');
  });

  it('handles absent reasons', () => {
    expect(formatInventoryReason(undefined)).toBe('-');
    expect(formatInventoryReason(null)).toBe('-');
    expect(formatInventoryReason('')).toBe('-');
  });
});
