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
export function loungeDailyPaymentStats(reloads: Row[], fees: Row[], storeId: string, start: number, end: number, asOf: number, users: Row[] = []) {
  const within = (value: unknown) => {
    const at = timestamp(value);
    return at >= start && at < end && at <= asOf;
  };
  let payments = 0, received = 0, reloadAmount = 0, annualFees = 0, newMemberReload = 0;
  const customers = new Set<string>(), members = new Set<string>(), activated = new Map<string, number>();
  for (const row of fees) {
    const at = timestamp(row.deductedAt);
    if (row.storeId !== storeId || row.status !== 'paid' || row.renewalType !== 'initial' || !row.userId || !Number.isFinite(at) || at >= end || at > asOf) continue;
    activated.set(row.userId, Math.min(activated.get(row.userId) ?? Infinity, at));
  }
  for (const [userId, at] of activated) if (at >= start) members.add(userId);
  for (const row of reloads) {
    if (row.storeId !== storeId || row.status !== 'completed' || !within(row.verifiedAt)) continue;
    const gross = cents(row.actualAmount ?? row.requestedAmount);
    // Legacy completed reloads predate package splitting; missing annualFeeAmount means no recorded package fee.
    const fee = cents(row.annualFeeAmount ?? 0);
    if (fee > gross) throw new Error('invalid-report-payment-amount');
    payments++; received += gross; annualFees += fee; reloadAmount += gross - fee;
    if (members.has(row.userId)) newMemberReload += gross - fee;
    if (row.userId) customers.add(row.userId);
  }
  return { payments, customers: customers.size, received: received / 100, reloadAmount: reloadAmount / 100,
    annualFees: annualFees / 100, newMembers: members.size, newMemberReload: newMemberReload / 100,
    registrations: users.filter(row => ['guest', 'member', 'vip'].includes(row.role) && within(row.createdAt)).length,
    accumulatedRegistrations: users.filter(row => ['guest', 'member', 'vip'].includes(row.role)
      && Number.isFinite(timestamp(row.createdAt)) && timestamp(row.createdAt) < end && timestamp(row.createdAt) <= asOf).length,
    accumulatedActivations: activated.size };
}
