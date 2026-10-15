import { describe, expect, it } from 'vitest'
import {
  calculateCheckoutAffordability,
  isCurrentVisitCheckedIn,
  MINIMUM_RELOAD_AMOUNT_RM,
  shouldRedirectToCheckoutReload,
  shouldShowCheckoutReload
} from './visitCheckout'

describe('visit checkout affordability', () => {
  it('blocks checkout when the charge would create a negative balance', () => {
    expect(calculateCheckoutAffordability(20, 50)).toEqual({
      canCheckout: false,
      balanceAfterCharge: -30,
      shortfall: 30
    })
  })

  it('allows checkout when an adjustment refunds enough points', () => {
    expect(calculateCheckoutAffordability(-10, -25)).toEqual({
      canCheckout: true,
      balanceAfterCharge: 15,
      shortfall: 0
    })
  })

  it('defines the minimum reload amount as RM200', () => {
    expect(MINIMUM_RELOAD_AMOUNT_RM).toBe(200)
  })
})

describe('shouldShowCheckoutReload', () => {
  it('keeps Reload visible when a pending checkout still needs points', () => {
    expect(shouldShowCheckoutReload(80, true, 100, true)).toBe(true)
  })

  it('releases the pending checkout Reload state once enough points are available', () => {
    expect(shouldShowCheckoutReload(100, true, 100, true)).toBe(false)
  })

  it.each([0, 49, 50, 1000])('shows Reload outside a visit regardless of balance (%s)', points => {
    expect(shouldShowCheckoutReload(points, false, 0, false)).toBe(true)
  })
  it.each([0, 49, 50, 1000])('keeps Redeem during a visit regardless of balance (%s)', points => {
    expect(shouldShowCheckoutReload(points, false, 0, true)).toBe(false)
  })
})

describe('current check-in', () => {
  const session = { userId: 'user', status: 'pending' as const, checkInAt: new Date('2026-10-15T10:00:00+08:00') }
  it('recognizes only the current user ongoing visit', () => {
    expect(isCurrentVisitCheckedIn(session, 'user')).toBe(true)
    expect(isCurrentVisitCheckedIn(null, 'user')).toBe(false)
    expect(isCurrentVisitCheckedIn(session, 'another')).toBe(false)
    expect(isCurrentVisitCheckedIn(session, undefined)).toBe(false)
  })
  it('rejects completed, expired and checked-out historical sessions', () => {
    expect(isCurrentVisitCheckedIn({ ...session, status: 'completed' }, 'user')).toBe(false)
    expect(isCurrentVisitCheckedIn({ ...session, status: 'expired' }, 'user')).toBe(false)
    expect(isCurrentVisitCheckedIn({ ...session, checkOutAt: new Date() }, 'user')).toBe(false)
    expect(isCurrentVisitCheckedIn({ ...session, checkInAt: new Date('invalid') }, 'user')).toBe(false)
  })
})

describe('shouldRedirectToCheckoutReload', () => {
  it('redirects while a pending checkout still has a points shortfall', () => {
    expect(shouldRedirectToCheckoutReload(20, true, 28)).toBe(true)
  })

  it('stops redirecting after the balance covers the pending checkout', () => {
    expect(shouldRedirectToCheckoutReload(234.5, true, 28)).toBe(false)
  })

  it('does not force low-balance users to Reload without a pending checkout', () => {
    expect(shouldRedirectToCheckoutReload(20, false, 0)).toBe(false)
  })
})
