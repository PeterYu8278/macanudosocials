import { describe, expect, it } from 'vitest'
import type { RedemptionRecord } from '../types'
import { groupCigarRedemptions } from './cigarRedemptionGroups'

const record = (overrides: Partial<RedemptionRecord> = {}): RedemptionRecord => ({
  id: 'redemption-1', userId: 'member-1', cigarId: 'cigar-1', cigarName: 'Robusto',
  quantity: 1, status: 'completed', dayKey: '2026-09-30', redemptionIndex: 1,
  redeemedAt: new Date('2026-09-30T12:00:00Z'), redeemedBy: 'admin-1',
  createdAt: new Date('2026-09-30T12:00:00Z'), visitSessionId: 'visit-1',
  ...overrides,
})

describe('groupCigarRedemptions', () => {
  it('merges quantities across visits while retaining every record', () => {
    const groups = groupCigarRedemptions([
      record(), record({ id: 'redemption-2', visitSessionId: 'visit-2', quantity: 3 }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].completedQuantity).toBe(4)
    expect(groups[0].records.map(entry => entry.visitSessionId)).toEqual(['visit-1', 'visit-2'])
  })

  it('keeps pending quantities separate from redeemed quantities', () => {
    const [group] = groupCigarRedemptions([record(), record({ status: 'pending', quantity: 2 })])
    expect(group.completedQuantity).toBe(1)
    expect(group.pendingQuantity).toBe(2)
  })

  it('does not combine different cigar IDs with the same name', () => {
    expect(groupCigarRedemptions([record(), record({ cigarId: 'cigar-2' })])).toHaveLength(2)
  })

  it('groups legacy records without IDs by name and sorts recent records first', () => {
    const groups = groupCigarRedemptions([
      record({ cigarId: '', redeemedAt: new Date('2026-09-01T12:00:00Z') }),
      record({ cigarId: '', id: 'newer' }),
      record({ cigarId: 'cigar-2', redeemedAt: new Date('2026-09-10T12:00:00Z') }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].records[0].id).toBe('newer')
    expect(groups[0].completedQuantity).toBe(2)
    expect(groupCigarRedemptions([])).toEqual([])
  })
})
