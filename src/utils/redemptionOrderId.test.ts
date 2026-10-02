import { describe, expect, it, vi } from 'vitest'
import { getRedemptionOrderMonth, resolveRedemptionOrderId } from './redemptionOrderId'

describe('redemption order numbering', () => {
  const date = new Date(2026, 8, 30, 18, 10)

  it('uses the historical order month and the normal redemption suffix', async () => {
    expect(await resolveRedemptionOrderId({
      date, getMonthlyCount: async () => 12, exists: async () => false,
    })).toBe('ORD-2026-09-0013-R')
  })

  it('skips occupied numbers instead of overwriting an order', async () => {
    const exists = vi.fn(async (id: string) => id !== 'ORD-2026-09-0004-R')
    expect(await resolveRedemptionOrderId({
      date, getMonthlyCount: async () => 1, exists,
    })).toBe('ORD-2026-09-0004-R')
    expect(exists).toHaveBeenCalledTimes(3)
  })

  it.each(['ORD-2026-09-0013-R', 'REDEMPTION-legacy_session'])('reuses linked order %s on reimport', async existingId => {
    const getMonthlyCount = vi.fn(async () => 0)
    const exists = vi.fn(async () => false)
    expect(await resolveRedemptionOrderId({ date, existingId, getMonthlyCount, exists })).toBe(existingId)
    expect(getMonthlyCount).not.toHaveBeenCalled()
    expect(exists).not.toHaveBeenCalled()
  })

  it('uses inclusive month boundaries, including leap years', () => {
    const month = getRedemptionOrderMonth(new Date(2024, 1, 29))
    expect(month.prefix).toBe('ORD-2024-02-')
    expect(month.start).toEqual(new Date(2024, 1, 1))
    expect(month.end).toEqual(new Date(2024, 1, 29, 23, 59, 59, 999))
  })
})
