import dayjs from 'dayjs'
import type { MembershipFeeRecord, PointsRecord, ReloadRecord, User, VisitSession } from '../types'
import { toDateOrNull } from '../services/firebase/core/sanitize'
import { netReloadPoints } from './reloadPoints'

export type ReportRecord<T> = T & { migration?: { source?: string; batchId?: string; balanceNotApplied?: boolean } }
type Reload = ReportRecord<ReloadRecord> & { annualFeeAmount?: number; walletAmount?: number }
const format = (value: unknown) => {
  const date = toDateOrNull(value)
  return date ? dayjs(date).format('YYYY-MM-DD HH:mm:ss') : '-'
}
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const money = (value: number) => Math.round(value * 100) / 100
const newestFirst = <T>(records: T[], date: (record: T) => unknown) => [...records].sort((a, b) =>
  (toDateOrNull(date(b))?.getTime() || 0) - (toDateOrNull(date(a))?.getTime() || 0))
const history = (record: ReportRecord<unknown>) => record.migration?.balanceNotApplied === true || record.migration?.source === 'legacy_workbook'
const identity = (id: string, users: Map<string, User>, fallback?: string) => {
  const user = users.get(id)
  return { 'User ID': id, 'Member ID': user?.memberId || '-', Name: user?.displayName || fallback || '-',
    Phone: user?.phone || user?.profile?.phone || '-', Email: user?.email || '-' }
}
const signed = (record: PointsRecord) => numeric(record.amount) && record.amount >= 0
  ? record.type === 'earn' ? record.amount : record.type === 'spend' ? -record.amount : null : null

export function reloadReportRows(records: Reload[], users: User[]) {
  const members = new Map(users.map(user => [user.id, user]))
  return newestFirst(records, record => record.createdAt).map(record => ({
    'Reload ID': record.id, ...identity(record.userId, members, record.userName),
    'Requested Amount (RM)': record.requestedAmount,
    'Points Equivalent': record.status === 'completed' ? netReloadPoints(record) : '-', 'Annual Fee Amount': record.annualFeeAmount ?? '-',
    Status: record.status, 'Payment Method': record.paymentMethod || (record.billplzId ? 'billplz' : '-'),
    'Payment Purpose': record.paymentPurpose || '-', 'Lounge ID': record.storeId || '-',
    'Created At': format(record.createdAt), 'Verified At': format(record.verifiedAt),
    'Verified By': record.verifiedByName || record.verifiedBy || '-', 'Points Record ID': record.pointsRecordId || '-',
    'Membership Order ID': record.membershipOrderId || '-', 'Billplz ID': record.billplzId || '-',
    'Proof URL': record.verificationProof || '-', Notes: record.adminNotes || '-',
    'Historical Import': history(record) ? 'Yes' : 'No', 'Migration Batch': record.migration?.batchId || '-',
  }))
}

export function pointsReportRows(records: ReportRecord<PointsRecord>[], users: User[]) {
  const members = new Map(users.map(user => [user.id, user]))
  return newestFirst(records, record => record.createdAt).map(record => ({
    'Record ID': record.id, ...identity(record.userId, members, record.userName), 'Created At': format(record.createdAt),
    Type: record.type, Source: record.source, Amount: record.amount, 'Signed Points': signed(record) ?? '-',
    'Balance After': numeric(record.balance) ? record.balance : '-', 'Related ID': record.relatedId || '-',
    Description: record.description || '-', 'Created By': record.createdBy || '-',
    'Wallet Effect': history(record) ? 'Historical only' : record.isVisitSessionSummary ? 'Cumulative summary only' : 'Wallet transaction',
    'Historical Import': history(record) ? 'Yes' : 'No', 'Migration Batch': record.migration?.batchId || '-',
  }))
}

export function balanceReportRows(users: User[], records: ReportRecord<PointsRecord>[], now = new Date()) {
  const members = new Map(users.map(user => [user.id, user]))
  const byUser = new Map<string, ReportRecord<PointsRecord>[]>()
  for (const record of records) {
    const entries = byUser.get(record.userId) || []
    entries.push(record)
    byUser.set(record.userId, entries)
  }
  return [...new Set([...members.keys(), ...byUser.keys()])].map(id => {
    const user = members.get(id), ledger = byUser.get(id) || []
    const live = ledger.filter(record => !history(record))
    const applied = live.filter(record => !record.isVisitSessionSummary)
    const checkpoints = live.filter(record => numeric(record.balance) && toDateOrNull(record.createdAt))
      .sort((a, b) => toDateOrNull(b.createdAt)!.getTime() - toDateOrNull(a.createdAt)!.getTime())
    const anchor = checkpoints[0]
    const anchorAt = anchor ? toDateOrNull(anchor.createdAt)!.getTime() : null
    const sameTime = anchorAt === null ? [] : live.filter(record => toDateOrNull(record.createdAt)?.getTime() === anchorAt)
    const ambiguous = anchor && sameTime.some(record => !numeric(record.balance) || record.balance !== anchor.balance)
    const later = applied.filter(record => anchorAt !== null && (toDateOrNull(record.createdAt)?.getTime() || 0) > anchorAt)
    const invalid = live.some(record => !toDateOrNull(record.createdAt) || signed(record) === null)
    const current = user?.membership?.points
    let status = !user ? 'User missing' : !numeric(current) ? 'Current balance missing'
      : !anchor ? 'No balance checkpoint' : invalid ? 'Invalid or undated ledger'
        : ambiguous ? 'Ambiguous checkpoint timestamp' : 'Check complete'
    const expected = status === 'Check complete' ? money(anchor!.balance! + later.reduce((sum, record) => sum + signed(record)!, 0)) : null
    const difference = expected === null ? null : money(current! - expected)
    if (difference !== null) status = difference === 0 ? 'Matches checkpoint' : 'Difference - review required'
    return { ...identity(id, members, ledger[0]?.userName), 'As Of': format(now),
      'Current Wallet Points': numeric(current) ? current : '-', 'Raw Ledger Records': ledger.length,
      'Historical Records Excluded': ledger.filter(history).length,
      'Summary Records Excluded': live.filter(record => record.isVisitSessionSummary).length,
      'Recorded Live Credits': money(applied.filter(record => record.type === 'earn' && signed(record) !== null).reduce((sum, record) => sum + record.amount, 0)),
      'Recorded Live Debits': money(applied.filter(record => record.type === 'spend' && signed(record) !== null).reduce((sum, record) => sum + record.amount, 0)),
      'Checkpoint Record ID': anchor?.id || '-', 'Checkpoint At': anchor ? format(anchor.createdAt) : '-',
      'Checkpoint Balance': anchor?.balance ?? '-', 'Expected From Checkpoint': expected ?? '-',
      'Difference': difference ?? '-', 'Reconciliation Status': status,
      'Scope': 'All-time raw ledger; current wallet snapshot',
    }
  })
}

export function membershipFeeReportRows(records: ReportRecord<MembershipFeeRecord>[], users: User[]) {
  const members = new Map(users.map(user => [user.id, user]))
  return newestFirst(records, record => record.deductedAt || record.dueDate || record.createdAt).map(record => ({
    'Fee Record ID': record.id, ...identity(record.userId, members, record.userName),
    Type: record.renewalType, Status: record.status, 'Fee Amount (Points)': record.amount,
    'Due Date': format(record.dueDate), 'Actual Deducted At': format(record.deductedAt),
    'Previous Due Date': format(record.previousDueDate), 'Created At': format(record.createdAt),
    'Last Attempt Result': record.lastAttemptResult || '-', 'Lounge ID': record.storeId || '-',
    'Points Record ID': record.pointsRecordId || '-', 'Historical Import': history(record) ? 'Yes' : 'No',
    'Migration Batch': record.migration?.batchId || '-',
  }))
}

export function visitReportRows(records: ReportRecord<VisitSession>[], users: User[]) {
  const members = new Map(users.map(user => [user.id, user]))
  return newestFirst(records, record => record.checkInAt).map(record => ({
    'Session ID': record.id, ...identity(record.userId, members, record.userName),
    'Lounge ID': record.storeId, Lounge: record.storeName || '-', Type: record.checkInType || '-', Status: record.status,
    'Check In At': format(record.checkInAt), 'Check Out At': format(record.checkOutAt),
    'Check In By': record.checkInBy || '-', 'Check Out By': record.checkOutBy || '-',
    'Duration Minutes': record.durationMinutes ?? '-', 'Duration Hours': record.durationHours ?? '-',
    'Recorded Points Deducted': record.pointsDeducted ?? '-', 'Realtime Points Deducted': record.realtimePointsDeducted ?? '-',
    'Rebate Points': record.rebatePoints ?? '-', 'Points Record ID': record.pointsRecordId || '-',
    'Rebate Record ID': record.rebatePointsRecordId || '-', 'Settlement Status': record.checkoutPending?.status || '-',
    'Points Due Now': record.checkoutPending?.pointsDueNow ?? '-', 'Shortfall': record.checkoutPending?.shortfall ?? '-',
    'Day Pass Purchased': record.dayPass?.isPurchased ? 'Yes' : 'No',
    'Redeemed Cigars': (record.redemptions || []).reduce((sum, entry) => sum + entry.quantity, 0),
    'Order ID': record.orderId || '-', 'Historical Import': history(record) ? 'Yes' : 'No', 'Migration Batch': record.migration?.batchId || '-',
  }))
}
