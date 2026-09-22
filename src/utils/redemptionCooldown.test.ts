import { describe, expect, it } from 'vitest'
import { getRedemptionCooldownSeconds, REDEMPTION_COOLDOWN_SECONDS } from './redemptionCooldown'

describe('getRedemptionCooldownSeconds', () => {
  const now = new Date('2026-09-22T10:00:00.000Z')

  it('returns zero without previous redemptions', () => {
    expect(getRedemptionCooldownSeconds([], now)).toBe(0)
  })

  it('uses the latest redemption across devices', () => {
    const records = [
      { redeemedAt: new Date('2026-09-22T08:00:00.000Z') },
      { redeemedAt: new Date('2026-09-22T09:45:00.000Z') }
    ]

    expect(getRedemptionCooldownSeconds(records, now)).toBe(45 * 60)
  })

  it('expires after one hour', () => {
    const records = [{ redeemedAt: new Date('2026-09-22T09:00:00.000Z') }]

    expect(getRedemptionCooldownSeconds(records, now)).toBe(0)
  })

  it('supports Firestore timestamp-like values', () => {
    const records = [{ redeemedAt: { seconds: now.getTime() / 1000 } }]

    expect(getRedemptionCooldownSeconds(records, now)).toBe(REDEMPTION_COOLDOWN_SECONDS)
  })
})
