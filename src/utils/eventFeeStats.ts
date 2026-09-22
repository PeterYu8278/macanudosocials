export interface EventFeeStats {
  payerCount: number;
  feeQuantity: number;
  feeUnit: number;
  feeTotal: number;
}

interface EventFeeSource {
  participants?: {
    registered?: string[];
    fee?: number;
  };
  allocations?: Record<string, {
    feeQuantity?: number;
    feeUnitPrice?: number;
  }>;
}

export function calculateEventFeeStats(event?: EventFeeSource | null): EventFeeStats {
  if (!event) {
    return { payerCount: 0, feeQuantity: 0, feeUnit: 0, feeTotal: 0 };
  }

  const registeredParticipants = event.participants?.registered || [];
  const feeUnitFallback = Number(event.participants?.fee || 0);

  return registeredParticipants.reduce<EventFeeStats>((stats, userId) => {
    const allocation = event.allocations?.[userId];
    const parsedQuantity = allocation?.feeQuantity == null
      ? 1
      : Number(allocation.feeQuantity);
    const quantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0
      ? parsedQuantity
      : 1;
    const parsedUnitPrice = allocation?.feeUnitPrice == null
      ? feeUnitFallback
      : Number(allocation.feeUnitPrice);
    const unitPrice = Number.isFinite(parsedUnitPrice) ? parsedUnitPrice : feeUnitFallback;

    if (unitPrice > 0) {
      stats.payerCount += 1;
      stats.feeQuantity += quantity;
      stats.feeTotal += unitPrice * quantity;
    }

    return stats;
  }, {
    payerCount: 0,
    feeQuantity: 0,
    feeUnit: feeUnitFallback,
    feeTotal: 0,
  });
}
