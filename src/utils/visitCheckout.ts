export const MINIMUM_RELOAD_AMOUNT_RM = 300

export interface CheckoutAffordability {
  canCheckout: boolean
  balanceAfterCharge: number
  shortfall: number
}

export const calculateCheckoutAffordability = (
  currentPoints: number,
  pointsDueNow: number
): CheckoutAffordability => {
  const safeBalance = Number.isFinite(currentPoints) ? currentPoints : 0
  const safeDue = Number.isFinite(pointsDueNow) ? pointsDueNow : 0
  const balanceAfterCharge = safeBalance - safeDue

  return {
    canCheckout: balanceAfterCharge >= 0,
    balanceAfterCharge,
    shortfall: Math.max(0, -balanceAfterCharge)
  }
}

export const shouldShowCheckoutReload = (
  currentPoints: number,
  checkoutPending: boolean,
  pointsDueNow: number
): boolean => {
  const safePoints = Number.isFinite(currentPoints) ? currentPoints : 0
  const safeDue = Number.isFinite(pointsDueNow) ? pointsDueNow : 0
  return (checkoutPending && safePoints < safeDue) || safePoints < 50
}

export const shouldRedirectToCheckoutReload = (
  currentPoints: number,
  checkoutPending: boolean,
  pointsDueNow: number
): boolean => {
  const safePoints = Number.isFinite(currentPoints) ? currentPoints : 0
  const safeDue = Number.isFinite(pointsDueNow) ? pointsDueNow : 0
  return checkoutPending && safePoints < safeDue
}
