import { describe, expect, it } from 'vitest'
import type { ReloadRecord, Transaction } from '../../../types'
import { getRevenueTotals } from './revenue'

const createdAt = new Date(2026, 9, 1)
const verifiedAt = new Date(2026, 9, 5)
const key = (date: Date) => String(date.getDate())
const reload = (fields: Partial<ReloadRecord> = {}) => ({
  id: 'reload', requestedAmount: 200, status: 'completed', storeId: 'a', createdAt, verifiedAt, ...fields,
}) as ReloadRecord
const transaction = (fields: Partial<Transaction> = {}) => ({
  id: 'sale', amount: 50, storeId: 'a', createdAt: verifiedAt, ...fields,
}) as Transaction

describe('dashboard revenue including reloads', () => {
  it('adds completed reloads on confirmation date and leaves transactions intact', () => {
    expect(getRevenueTotals([transaction()], [reload()], key).get('5')).toBe(250)
    expect(getRevenueTotals([], [reload({ verifiedAt: undefined })], key).get('1')).toBe(200)
  })
  it('excludes pending, rejected, invalid and nonpositive amounts', () => {
    expect(getRevenueTotals([], [reload({ status: 'pending' }), reload({ status: 'rejected' }),
      reload({ requestedAmount: NaN }), reload({ requestedAmount: -1 }),
      reload({ verifiedAt: new Date('invalid') })], key).size).toBe(0)
  })
  it('limits revenue to the assigned lounge but includes all lounges for super administrators', () => {
    const reloads = [reload(), reload({ id: 'other', storeId: 'b' })]
    expect(getRevenueTotals([transaction({ storeId: 'b' })], reloads, key, 'a').get('5')).toBe(200)
    expect(getRevenueTotals([transaction()], reloads, key).get('5')).toBe(450)
  })
  it('does not add a reload twice when a transaction explicitly references it', () => {
    expect(getRevenueTotals([transaction({ relatedId: 'reload', amount: 200 })], [reload()], key).get('5')).toBe(200)
  })
  it('aggregates the same revenue into monthly buckets', () => {
    expect(getRevenueTotals([transaction()], [reload()], date => String(date.getMonth())).get('9')).toBe(250)
  })
})
