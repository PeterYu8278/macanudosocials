// Only these fields may be exposed to a member. Never copy the private order wholesale.
export function membershipPaymentStatusData(order: Record<string, unknown>) {
  const fields = ['userId', 'status', 'paymentMethod', 'paymentMode', 'annualFee', 'reloadAmount',
    'totalCents', 'storeId', 'renewalType', 'createdAt', 'updatedAt'];
  return Object.fromEntries(fields.filter(key => order[key] !== undefined).map(key => [key, order[key]]));
}
