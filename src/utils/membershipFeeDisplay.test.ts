import { describe, it, expect } from 'vitest'
import type { MembershipFeeRecord, User } from '../types'
import { getMembershipFeeDisplayStatus, matchesMembershipFeeSearch, sortMembershipFeeRecords } from './membershipFeeDisplay'
const now = new Date('2026-10-06T00:00:00Z')
const record = { id: 'fee', status: 'pending', dueDate: new Date('2027-10-05T08:40:00Z'), createdAt: now } as MembershipFeeRecord
describe('membership fee display', () => {
  it('searches current and recorded names, member IDs and emails case-insensitively', () => {
    const fee = { ...record, userId: 'user-123', userName: 'Recorded Name' }
    const member = { displayName: 'Current Name', memberId: '4U714X', email: 'Member@Example.com' }
    for (const query of [' recorded ', 'CURRENT', '4u714x', 'member@example', 'user-123', 'fee']) {
      expect(matchesMembershipFeeSearch(fee, member, query)).toBe(true)
    }
    expect(matchesMembershipFeeSearch(fee, member, 'other')).toBe(false)
  })
  it('matches both phone fields and formatted telephone searches', () => {
    const member: Partial<User> = { phone: '+60 12-945 4703', profile: { phone: '+60115555555' } as User['profile'] }
    expect(matchesMembershipFeeSearch(record, member, '+60 (12) 945-4703')).toBe(true)
    expect(matchesMembershipFeeSearch(record, member, '0115555555')).toBe(true)
    expect(matchesMembershipFeeSearch(record, member, 'abc4703')).toBe(false)
  })
  it('handles cleared search and unavailable member profiles without hiding matching ledger names', () => {
    expect(matchesMembershipFeeSearch(record, undefined, '  ')).toBe(true)
    expect(matchesMembershipFeeSearch({ ...record, userName: 'Legacy' }, undefined, 'legacy')).toBe(true)
    expect(matchesMembershipFeeSearch(record, undefined, 'unknown')).toBe(false)
  })
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
