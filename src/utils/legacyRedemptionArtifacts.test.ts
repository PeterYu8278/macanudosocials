import { describe, expect, it } from 'vitest'
import { mergeLegacyRedemptionEntries, type LegacyRedemptionEntry } from './legacyRedemptionArtifacts'

const entry = (overrides: Partial<LegacyRedemptionEntry>): LegacyRedemptionEntry => ({
  id: 'redemption-1',
  cigarId: 'legacy_slot_robusto',
  cigarName: 'Robusto',
  quantity: 1,
  status: 'completed',
  ...overrides,
})

describe('mergeLegacyRedemptionEntries', () => {
  it('replaces the same migration row instead of duplicating its inventory quantity', () => {
    const incoming = entry({ quantity: 1 })
    const result = mergeLegacyRedemptionEntries([entry({ quantity: 1 })], incoming)

    expect(result.redemptions).toHaveLength(1)
    expect(result.totals).toEqual([{ cigarId: 'legacy_slot_robusto', cigarName: 'Robusto', quantity: 1 }])
  })

  it('aggregates completed redemptions for the same temporary cigar', () => {
    const result = mergeLegacyRedemptionEntries(
      [entry({ id: 'redemption-1', quantity: 1 })],
      entry({ id: 'redemption-2', quantity: 2 })
    )

    expect(result.totals).toEqual([{ cigarId: 'legacy_slot_robusto', cigarName: 'Robusto', quantity: 3 }])
  })

  it('does not create outbound quantities for incomplete records', () => {
    const result = mergeLegacyRedemptionEntries([], entry({ status: 'pending' }))
    expect(result.totals).toEqual([])
  })
})
