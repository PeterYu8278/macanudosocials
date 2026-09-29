import { describe, expect, it } from 'vitest'
import { calculateRebateReward, calculatePurchaseReward } from './purchaseRewards'

describe('calculatePurchaseReward', () => {
  it('calculates the same configured rebate for a visit settlement', () => {
    expect(calculateRebateReward(30, 10)).toEqual({ points: 3, rate: 10 })
  })

  it('returns the configured percentage of the purchase total', () => {
    expect(calculatePurchaseReward(199.99, { perRinggit: 1, rebatePercent: 5 })).toEqual({
      points: 9,
      method: 'rebatePercent',
      rate: 5,
    })
  })

  it('allows zero percent to explicitly disable purchase rewards', () => {
    expect(calculatePurchaseReward(100, { perRinggit: 2, rebatePercent: 0 }).points).toBe(0)
  })

  it('uses the legacy points-per-RM rule when no percentage is configured', () => {
    expect(calculatePurchaseReward(25.5, { perRinggit: 1.5 })).toEqual({
      points: 38,
      method: 'perRinggit',
      rate: 1.5,
    })
    expect(calculatePurchaseReward(25.5, { perRinggit: 1.5, rebatePercent: null }).points).toBe(38)
  })

  it('clamps invalid totals and rebate percentages', () => {
    expect(calculatePurchaseReward(-100, { rebatePercent: 10 }).points).toBe(0)
    expect(calculatePurchaseReward(100, { rebatePercent: 150 }).points).toBe(100)
  })
})
