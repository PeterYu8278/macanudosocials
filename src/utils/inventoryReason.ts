const VISIT_REDEMPTION_STOCK_OUT = 'Visit session redemption stock-out';

export function visitRedemptionStockOutReason(sessionId: string): string {
  return `${VISIT_REDEMPTION_STOCK_OUT} (Session: ${sessionId})`;
}

export function formatInventoryReason(reason?: string | null): string {
  // Translate only the known system-generated legacy reason, not user-entered notes.
  return reason?.replace(/^驻店兑换出库(?=\s*(?:\(Session:|$))/, VISIT_REDEMPTION_STOCK_OUT) || '-';
}
