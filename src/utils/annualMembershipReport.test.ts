import { describe, expect, it } from 'vitest'
import type { MembershipFeeRecord, User } from '../types'
import { annualMembershipReportRows } from './annualMembershipReport'

const now = new Date('2026-10-11T12:00:00Z')
const user = (id: string, overrides: Partial<User> = {}): User => ({
  id, email: `${id}@example.com`, displayName: id, role: 'member',
  createdAt: now, updatedAt: now, ...overrides,
})
const fee = (id: string, userId: string, overrides: Partial<MembershipFeeRecord> = {}): MembershipFeeRecord => ({
  id, userId, amount: 199, status: 'paid', renewalType: 'initial',
  deductedAt: new Date('2025-10-11T12:00:00Z'), dueDate: now,
  createdAt: now, updatedAt: now, ...overrides,
})

describe('annual membership report', () => {
  it('marks missing paid records for review instead of claiming zero payment', () => {
    const rows = annualMembershipReportRows([user('a', { membership: {
      level: 'bronze', firstActivatedAt: new Date('2026-10-11T09:53:14Z'),
      activeFrom: new Date('2026-10-11T09:56:31Z'), activeUntil: new Date('2027-10-11T09:56:31Z'),
    } })], [fee('next-year', 'a', { status: 'pending' })], null, null, now)
    expect(rows[0]).toMatchObject({
      'Paid Annual Fee Count': '-', 'Total Paid Annual Fee (Points)': '-',
      'Last Recorded Fee Payment': 'No matching paid fee record',
      'Fee Record Check': 'No matching paid fee record', 'Paid Fee Record IDs': '-',
    })
  })

  it('does not misrepresent record creation as a payment time and preserves localized review labels', () => {
    const rows = annualMembershipReportRows([user('a')], [fee('paid', 'a', { deductedAt: undefined })],
      null, null, now, { missingPayment: 'missing', recordedPayment: 'recorded', missingPaymentDate: 'unknown time' })
    expect(rows[0]).toMatchObject({
      'Paid Annual Fee Count': 1, 'Total Paid Annual Fee (Points)': 199,
      'Last Recorded Fee Payment': 'unknown time', 'Fee Record Check': 'recorded', 'Paid Fee Record IDs': 'paid',
    })
  })

  it('deduplicates members and records, counts paid fees only', () => {
    const initial = fee('initial', 'a')
    const rows = annualMembershipReportRows([user('a')], [initial, initial,
      fee('renewal', 'a', { renewalType: 'renewal', deductedAt: now }),
      fee('pending', 'a', { status: 'pending' }), fee('cancelled', 'a', { status: 'cancelled' }),
      fee('failed', 'a', { status: 'failed' }), fee('zero', 'a', { amount: 0 })], null, null, now)
    expect(rows).toHaveLength(1)
    expect(rows[0]['Paid Annual Fee Count']).toBe(2)
    expect(rows[0]['Total Paid Annual Fee (Points)']).toBe(398)
  })

  it('excludes pending-only users, role and balance alone, and future activation dates', () => {
    const rows = annualMembershipReportRows([
      user('pending'), user('vip', { role: 'vip', membership: { level: 'gold', points: 1000 } }),
      user('future', { membership: { level: 'bronze', firstActivatedAt: new Date('2027-01-01') } }),
    ], [fee('p', 'pending', { status: 'pending' })], null, null, now)
    expect(rows).toEqual([])
  })

  it('includes expired legacy periods and suspended accounts without treating validity as account access', () => {
    const rows = annualMembershipReportRows([
      user('expired', { profile: { phone: '123' } as User['profile'], membership: {
        level: 'bronze', activeFrom: new Date('2024-01-01'), activeUntil: new Date('2025-01-01'),
      } }),
      user('suspended', { status: 'suspended', membership: {
        level: 'bronze', activeFrom: new Date('2026-01-01'), activeUntil: new Date('2027-01-01'),
      } }),
    ], [], null, null, now)
    expect(rows.find(row => row['User ID'] === 'expired')).toMatchObject({
      'Annual Pass Period': 'Expired', Phone: '123', 'Activation Evidence': 'Membership Dates',
    })
    expect(rows.find(row => row['User ID'] === 'suspended')).toMatchObject({
      'Account Status': 'suspended', 'Annual Pass Period': 'Valid',
    })
  })

  it('filters inclusively by earliest recorded activation, not renewal or pending creation', () => {
    const initialDate = new Date('2025-10-11T12:00:00Z')
    const records = [fee('i', 'a'), fee('r', 'a', { deductedAt: now, renewalType: 'renewal' })]
    expect(annualMembershipReportRows([user('a')], records, initialDate, initialDate, now)).toHaveLength(1)
    expect(annualMembershipReportRows([user('a')], records, now, now, now)).toEqual([])
  })

  it('handles timestamp values, missing profiles, and unknown dates without inventing activation', () => {
    const first = { toDate: () => new Date('2024-01-01') } as unknown as Date
    const rows = annualMembershipReportRows([user('legacy', { membership: { level: 'bronze', firstActivatedAt: first } })],
      [fee('deleted', 'missing', { userName: 'Former Member', deductedAt: undefined, createdAt: new Date('invalid') })],
      null, null, now)
    expect(rows.find(row => row['User ID'] === 'legacy')?.['First Recorded Activation']).not.toBe('-')
    expect(rows.find(row => row['User ID'] === 'missing')).toMatchObject({ Name: 'Former Member', Email: '-', 'First Recorded Activation': '-' })
    expect(annualMembershipReportRows([], [fee('unknown', 'missing', { deductedAt: undefined, createdAt: new Date('invalid') })], now, now, now)).toEqual([])
  })
})
