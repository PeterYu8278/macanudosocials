type Row = Record<string, any>;

const timestamp = (value: any): number => {
  if (value == null) return NaN;
  return new Date(value?.toDate?.() || value).getTime();
};
const cents = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('invalid-report-payment-amount');
  return Math.round(value * 100);
};

/** Payment receipts, not points credits/rewards. The initial package's annual fee is separate. */
export function loungeDailyPaymentStats(reloads: Row[], fees: Row[], storeId: string, start: number, end: number, asOf: number) {
  const within = (value: unknown) => {
    const at = timestamp(value);
    return at >= start && at < end && at <= asOf;
  };
  let payments = 0, received = 0, reloadAmount = 0, annualFees = 0;
  const customers = new Set<string>(), members = new Set<string>();
  for (const row of reloads) {
    if (row.storeId !== storeId || row.status !== 'completed' || !within(row.verifiedAt)) continue;
    const gross = cents(row.actualAmount ?? row.requestedAmount);
    // Legacy completed reloads predate package splitting; missing annualFeeAmount means no recorded package fee.
    const fee = cents(row.annualFeeAmount ?? 0);
    if (fee > gross) throw new Error('invalid-report-payment-amount');
    payments++; received += gross; annualFees += fee; reloadAmount += gross - fee;
    if (row.userId) customers.add(row.userId);
  }
  for (const row of fees) {
    if (row.storeId === storeId && row.status === 'paid' && row.renewalType === 'initial'
      && row.userId && within(row.deductedAt)) members.add(row.userId);
  }
  return { payments, customers: customers.size, received: received / 100, reloadAmount: reloadAmount / 100,
    annualFees: annualFees / 100, newMembers: members.size };
}
