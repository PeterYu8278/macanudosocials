export const calculateBookingPayment = (
  totalFee: number,
  hasActiveVisitSession: boolean
): number => {
  const safeTotal = Number.isFinite(totalFee) ? Math.max(0, totalFee) : 0
  return Math.round(safeTotal * (hasActiveVisitSession ? 1 : 0.5))
}

export const calculateBookingBalance = (totalFee: number, paidFee: number): number => (
  Math.max(0, totalFee - paidFee)
)
