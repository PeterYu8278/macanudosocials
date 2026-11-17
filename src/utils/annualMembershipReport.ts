import dayjs from 'dayjs'
import type { MembershipFeeRecord, User } from '../types'
import { toDateOrNull } from '../services/firebase/core/sanitize'

export function annualMembershipReportRows(
  users: User[],
  records: MembershipFeeRecord[],
  start?: Date | null,
  end?: Date | null,
  now = new Date(),
  labels = {
    missingPayment: 'No matching paid fee record',
    recordedPayment: 'Paid fee recorded',
    missingPaymentDate: 'Payment time not recorded',
  }
) {
  const usersById = new Map(users.map(user => [user.id, user]))
  const paidByUser = new Map<string, MembershipFeeRecord[]>()
  const seen = new Set<string>()
  for (const record of records) {
    if (seen.has(record.id) || record.status !== 'paid' || !Number.isFinite(record.amount) || record.amount <= 0) continue
    seen.add(record.id)
    paidByUser.set(record.userId, [...(paidByUser.get(record.userId) || []), record])
  }
  const ids = new Set([...usersById.keys(), ...paidByUser.keys()])
  const format = (date: Date | null) => date ? dayjs(date).format('YYYY-MM-DD HH:mm:ss') : '-'
  const entries = [...ids].flatMap(id => {
    const user = usersById.get(id)
    const paid = paidByUser.get(id) || []
    const from = toDateOrNull(user?.membership?.activeFrom)
    const until = toDateOrNull(user?.membership?.activeUntil)
    const first = toDateOrNull(user?.membership?.firstActivatedAt)
    const hasPeriod = Boolean(from && until && from <= now && until > from)
    const hasFirst = Boolean(first && first <= now)
    if (!paid.length && !hasFirst && !hasPeriod) return []
    // Pending fee creation dates are not activation evidence. Legacy paid records
    // use createdAt only when no actual deduction timestamp was recorded.
    const paymentDates = paid.map(record => toDateOrNull(record.deductedAt))
      .filter((date): date is Date => Boolean(date && date <= now))
    const recordedDates = paid.map(record => toDateOrNull(record.deductedAt) || toDateOrNull(record.createdAt))
      .filter((date): date is Date => Boolean(date && date <= now))
    const dates = [...recordedDates, ...(hasFirst ? [first!] : []), ...(hasPeriod ? [from!] : [])]
      .sort((a, b) => a.getTime() - b.getTime())
    const activatedAt = dates[0] || null
    if ((start || end) && (!activatedAt || (start && activatedAt < start) || (end && activatedAt > end))) return []
    const period = !from || !until || until <= from ? 'Unknown'
      : from > now ? 'Not Started' : until <= now ? 'Expired' : 'Valid'
    return [{ activatedAt, row: {
      'User ID': id,
      'Member ID': user?.memberId || '-',
      'Name': user?.displayName || paid.find(record => record.userName)?.userName || '-',
      'Phone': user?.phone || user?.profile?.phone || '-',
      'Email': user?.email || '-',
      'Account Status': user?.status || 'Unknown',
      'Annual Pass Period': period,
      'First Recorded Activation': format(activatedAt),
      'Active From': format(from),
      'Active Until': format(until),
      'Current Points': user?.membership?.points ?? 0,
      'Paid Annual Fee Count': paid.length || '-',
      'Total Paid Annual Fee (Points)': paid.length
        ? paid.reduce((total, record) => total + Math.round(record.amount * 100), 0) / 100 : '-',
      'Last Recorded Fee Payment': !paid.length ? labels.missingPayment
        : paymentDates.length ? format(paymentDates.sort((a, b) => b.getTime() - a.getTime())[0]) : labels.missingPaymentDate,
      'Fee Record Check': paid.length ? labels.recordedPayment : labels.missingPayment,
      'Paid Fee Record IDs': paid.map(record => record.id).join(', ') || '-',
      'Activation Evidence': paid.length ? 'Paid Annual Fee' : 'Membership Dates',
    } }]
  })
  return entries.sort((a, b) => (b.activatedAt?.getTime() || 0) - (a.activatedAt?.getTime() || 0)
    || a.row['User ID'].localeCompare(b.row['User ID']))
    .map((entry, index) => ({ 'No.': index + 1, ...entry.row }))
}
