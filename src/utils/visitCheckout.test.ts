import { describe, expect, it } from 'vitest'
import { calculateCheckoutAffordability, MINIMUM_RELOAD_AMOUNT_RM } from './visitCheckout'

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
