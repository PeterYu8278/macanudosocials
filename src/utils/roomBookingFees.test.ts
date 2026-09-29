import { describe, expect, it } from 'vitest'
import { calculateBookingBalance, calculateBookingPayment } from './roomBookingFees'

describe('room booking fees', () => {
  it('charges the full fee when the user already has an active visit session', () => {
    expect(calculateBookingPayment(200, true)).toBe(200)
    expect(calculateBookingBalance(200, 200)).toBe(0)
  })

  it('charges a 50% deposit before the user checks in', () => {
    expect(calculateBookingPayment(200, false)).toBe(100)
    expect(calculateBookingBalance(200, 100)).toBe(100)
  })
})
