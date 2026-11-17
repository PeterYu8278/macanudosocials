import { describe, expect, it } from 'vitest'
import { aggregateCompletedRedemptions, areRedemptionsReadyForSettlement, isVisitRedemptionOrder } from './redemptionOrder'

describe('internal visit redemption order visibility', () => {
  it.each(['Visit redemption (Session: checkin_member_123)', '驻店兑换订单 (Session: session-123)'])('identifies generated internal order: %s', note => {
    expect(isVisitRedemptionOrder({ source: { type: 'direct', note } })).toBe(true)
  })
  it('keeps ordinary purchases and unlinked zero-value orders visible', () => {
    expect(isVisitRedemptionOrder({})).toBe(false)
    expect(isVisitRedemptionOrder({ source: { type: 'direct', note: 'In-store purchase' } })).toBe(false)
  })
})

describe('areRedemptionsReadyForSettlement', () => {
  it('requires at least one redemption and no pending choices', () => {
    expect(areRedemptionsReadyForSettlement([])).toBe(false)
    expect(areRedemptionsReadyForSettlement([{ status: 'completed' }])).toBe(true)
    expect(areRedemptionsReadyForSettlement([
      { status: 'completed' },
      { status: 'pending' }
    ])).toBe(false)
  })
})

describe('aggregateCompletedRedemptions', () => {
  it('uses completed redemption quantities and combines the same cigar', () => {
    const result = aggregateCompletedRedemptions([
      { cigarId: 'cigar-1', cigarName: 'Cigar One', quantity: 1, status: 'completed' },
      { cigarId: 'cigar-1', cigarName: 'Cigar One', quantity: 2, status: 'completed' },
      { cigarId: 'cigar-2', cigarName: 'Pending', quantity: 5, status: 'pending' }
    ])

    expect(result).toEqual([
      { cigarId: 'cigar-1', cigarName: 'Cigar One', quantity: 3 }
    ])
  })

  it('ignores invalid or unconfirmed cigar selections', () => {
    expect(aggregateCompletedRedemptions([
      { cigarId: '', cigarName: 'Pending selection', quantity: 1, status: 'completed' },
      { cigarId: 'cigar-1', cigarName: 'Invalid quantity', quantity: 0, status: 'completed' }
    ])).toEqual([])
  })
})
