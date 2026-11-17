import type { MembershipFeeRecord, User } from '../types'
import { toDateOrNull } from '../services/firebase/core/sanitize'

export type MembershipFeeDisplayStatus = MembershipFeeRecord['status'] | 'scheduled' | 'insufficient'

export function matchesMembershipFeeSearch(record: MembershipFeeRecord, member: Partial<User> | undefined, search: string): boolean {
  const query = search.trim().toLowerCase()
  if (!query) return true
  if ([record.userName, record.userId, record.id, member?.displayName, member?.memberId,
    member?.email, member?.phone, member?.profile?.phone]
    .some(value => value?.toLowerCase().includes(query))) return true
  const digits = /^[+\d\s()-]+$/.test(query) ? query.replace(/\D/g, '') : ''
  return Boolean(digits && [member?.phone, member?.profile?.phone]
    .some(phone => phone?.replace(/\D/g, '').includes(digits)))
}

export function getMembershipFeeDisplayStatus(record: MembershipFeeRecord, now = new Date()): MembershipFeeDisplayStatus {
  if (record.status !== 'pending') return record.status
  const due = toDateOrNull(record.dueDate)
  if (due && due.getTime() > now.getTime()) return 'scheduled'
  if (record.lastAttemptResult === 'insufficient_points') return 'insufficient'
  return 'pending'
}

export function sortMembershipFeeRecords(records: MembershipFeeRecord[]): MembershipFeeRecord[] {
  const time = (record: MembershipFeeRecord) =>
    (toDateOrNull(record.deductedAt) || toDateOrNull(record.createdAt) || toDateOrNull(record.dueDate))?.getTime() || 0
  return [...records].sort((a, b) => time(b) - time(a) || a.id.localeCompare(b.id))
}
