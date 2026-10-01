import { describe, expect, it } from 'vitest'
import { calculateCheckoutAffordability, MINIMUM_RELOAD_AMOUNT_RM, shouldShowCheckoutReload } from './visitCheckout'

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

  it('defines the minimum reload amount as RM300', () => {
    expect(MINIMUM_RELOAD_AMOUNT_RM).toBe(300)
  })
})

describe('shouldShowCheckoutReload', () => {
  it('keeps Reload visible when a pending checkout still needs points', () => {
    expect(shouldShowCheckoutReload(80, true, 100)).toBe(true)
  })

  it('releases the pending checkout Reload state once enough points are available', () => {
    expect(shouldShowCheckoutReload(100, true, 100)).toBe(false)
  })

  it('keeps the existing low-balance Reload behavior', () => {
    expect(shouldShowCheckoutReload(49, false, 0)).toBe(true)
  })
})
