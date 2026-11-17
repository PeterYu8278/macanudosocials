import type { VisitSession } from '../types'
import { toDateOrNull } from '../services/firebase/core/sanitize'

export const MINIMUM_RELOAD_AMOUNT_RM = 200

export const isCurrentVisitCheckedIn = (
  session: Pick<VisitSession, 'userId' | 'status' | 'checkInAt' | 'checkOutAt' | 'scheduledCheckOutAt'> | null | undefined,
  userId: string | undefined
): boolean => Boolean(userId && session?.userId === userId && session.status === 'pending'
  && toDateOrNull(session.checkInAt) && !session.checkOutAt
  && (!session.scheduledCheckOutAt || (toDateOrNull(session.scheduledCheckOutAt)?.getTime() ?? 0) > Date.now()))

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
  pointsDueNow: number,
  checkedIn: boolean
): boolean => {
  return !checkedIn || shouldRedirectToCheckoutReload(currentPoints, checkoutPending, pointsDueNow)
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
