import { describe, expect, it } from 'vitest'
import type { PointsRecord } from '../types'
import { consolidateVisitPointsRecords } from './pointsRecordDisplay'

const record = (overrides: Partial<PointsRecord>): PointsRecord => ({
  id: 'record-1',
  userId: 'user-1',
  type: 'spend',
  amount: 10,
  source: 'visit',
  description: '驻店计时扣费',
  createdAt: new Date('2026-09-22T10:00:00Z'),
  ...overrides
})

describe('consolidateVisitPointsRecords', () => {
  it('hides visit deductions while their check-in session is pending', () => {
    const records = [record({ relatedId: 'pending-session' })]

    expect(consolidateVisitPointsRecords(records, new Set(['pending-session']))).toEqual([])
  })

  it('combines legacy deductions from the same completed session', () => {
    const records = [
      record({ id: 'latest', relatedId: 'session-1', amount: 13, balance: 617 }),
      record({ id: 'older', relatedId: 'session-1', amount: 13, balance: 630 })
    ]

    expect(consolidateVisitPointsRecords(records, new Set())).toEqual([
      expect.objectContaining({
        id: 'latest',
        amount: 26,
        balance: 617,
        description: '驻店计时扣费（本次驻店汇总）'
      })
    ])
  })

  it('uses the checkout cumulative summary instead of adding earlier charges again', () => {
    const records = [
      record({
        id: 'checkout-summary',
        relatedId: 'session-1',
        amount: 62.5,
        balance: 528.5,
        description: '驻店计时扣费 (2.5小时，共62.5积分)',
        isVisitSessionSummary: true
      }),
      record({
        id: 'initial-charge',
        relatedId: 'session-1',
        amount: 25,
        balance: 566,
        description: '驻店开始扣费 (1小时 × 25积分)'
      })
    ]

    expect(consolidateVisitPointsRecords(records, new Set())).toEqual([
      expect.objectContaining({
        id: 'checkout-summary',
        amount: 62.5,
        balance: 528.5
      })
    ])
  })

  it('does not merge unrelated visit charges that share a related id', () => {
    const records = [
      record({ id: 'deposit', relatedId: 'booking-1', amount: 50, description: '房间预订订金' }),
      record({ id: 'balance', relatedId: 'booking-1', amount: 50, description: '包厢签到扣除余款' })
    ]

    expect(consolidateVisitPointsRecords(records, new Set())).toHaveLength(2)
  })

  it('keeps deductions from different sessions separate', () => {
    const records = [
      record({ id: 'session-1-record', relatedId: 'session-1' }),
      record({ id: 'session-2-record', relatedId: 'session-2' })
    ]

    expect(consolidateVisitPointsRecords(records, new Set())).toHaveLength(2)
  })
})
