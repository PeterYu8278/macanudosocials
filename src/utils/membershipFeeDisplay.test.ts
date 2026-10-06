import { describe, it, expect } from 'vitest'
import type { MembershipFeeRecord } from '../types'
import { getMembershipFeeDisplayStatus, sortMembershipFeeRecords } from './membershipFeeDisplay'
const now = new Date('2026-10-06T00:00:00Z')
const record = { id: 'fee', status: 'pending', dueDate: new Date('2027-10-05T08:40:00Z'), createdAt: now } as MembershipFeeRecord
describe('membership fee display', () => {
  it('distinguishes next year scheduled fees from actual deductions', () => {
    expect(getMembershipFeeDisplayStatus(record, now)).toBe('scheduled')
    expect(getMembershipFeeDisplayStatus({ ...record, status: 'paid' }, now)).toBe('paid')
  })
  it('shows due fees and confirmed insufficient points separately', () => {
    const due = { ...record, dueDate: now }
    expect(getMembershipFeeDisplayStatus(due, now)).toBe('pending')
    expect(getMembershipFeeDisplayStatus({ ...due, lastAttemptResult: 'insufficient_points' }, now)).toBe('insufficient')
    expect(getMembershipFeeDisplayStatus({ ...record, lastAttemptResult: 'insufficient_points' }, now)).toBe('scheduled')
  })
  it('does not invent due or deduction dates for incomplete legacy records', () => {
    expect(getMembershipFeeDisplayStatus({ ...record, dueDate: null as unknown as Date }, now)).toBe('pending')
    expect(getMembershipFeeDisplayStatus({ ...record, status: 'paid', deductedAt: undefined }, now)).toBe('paid')
  })
  it('sorts by actual deduction date rather than next annual due date without mutation', () => {
    const paid = { ...record, id: 'paid', status: 'paid' as const, deductedAt: new Date('2026-10-07T00:00:00Z') }
    const records = [record, paid]
    expect(sortMembershipFeeRecords(records).map(r => r.id)).toEqual(['paid', 'fee'])
    expect(records[0]).toBe(record)
  })
})
