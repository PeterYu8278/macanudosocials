import { describe, expect, it } from 'vitest'
import { aggregateCompletedRedemptions } from './redemptionOrder'

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
