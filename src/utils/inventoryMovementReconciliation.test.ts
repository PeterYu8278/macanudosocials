import { describe, expect, it } from 'vitest'
import type { InventoryMovement, Order } from '../types'
import { reconcileOrderOutboundMovements } from './inventoryMovementReconciliation'

const movement = (overrides: Partial<InventoryMovement>): InventoryMovement => ({
  id: 'movement-1',
  cigarId: 'cigar-12',
  cigarName: '12',
  itemType: 'cigar',
  type: 'out',
  quantity: 1,
  referenceNo: 'ORD-2026-09-0001-R',
  reason: 'redemption',
  unitPrice: 11,
  createdAt: new Date('2026-09-23T00:00:00Z'),
  ...overrides
} as InventoryMovement)

const order = (quantity: number): Order => ({
  id: 'ORD-2026-09-0001-R',
  userId: 'user-1',
  items: [{ cigarId: 'cigar-12', quantity, price: 0 }],
  total: 0,
  status: 'completed',
  source: { type: 'direct' },
  payment: { method: 'bank_transfer' },
  shipping: { address: 'store' },
  createdAt: new Date(),
  updatedAt: new Date()
})

describe('reconcileOrderOutboundMovements', () => {
  it('caps duplicate outbound movements at the order quantity', () => {
    const result = reconcileOrderOutboundMovements([
      movement({ id: 'old', quantity: 1, createdAt: new Date('2026-09-23T00:00:00Z') }),
      movement({ id: 'new', quantity: 2, createdAt: new Date('2026-09-23T01:00:00Z') })
    ], [order(2)])

    expect(result.map(item => item.quantity)).toEqual([1, 1])
    expect(result.reduce((total, item) => total + item.quantity, 0)).toBe(2)
  })

  it('keeps legitimate split outbound movements unchanged', () => {
    const result = reconcileOrderOutboundMovements([
      movement({ id: 'first', quantity: 1 }),
      movement({ id: 'second', quantity: 1 })
    ], [order(2)])

    expect(result.map(item => item.quantity)).toEqual([1, 1])
  })

  it('does not alter movements without a matching order', () => {
    const manual = movement({ id: 'manual', referenceNo: 'OUT-0001', quantity: 3 })
    expect(reconcileOrderOutboundMovements([manual], [])).toEqual([manual])
  })
})
