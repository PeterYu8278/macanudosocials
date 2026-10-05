import type { ReloadRecord, Transaction } from '../../../types'
import { toDateOrNull } from '../../../utils/eventDisplay'

export function getRevenueTotals(
  transactions: Transaction[],
  reloads: ReloadRecord[],
  dateKey: (date: Date) => string,
  storeId?: string,
) {
  const totals = new Map<string, number>()
  const add = (amount: number, value: unknown) => {
    const date = toDateOrNull(value)
    if (!date || Number.isNaN(date.getTime()) || !Number.isFinite(amount) || amount <= 0) return
    const key = dateKey(date)
    totals.set(key, (totals.get(key) || 0) + amount)
  }
  const linkedReloadIds = new Set<string>()
  transactions.forEach(transaction => {
    if (storeId && transaction.storeId !== storeId) return
    add(Number(transaction.amount), transaction.createdAt)
    if (transaction.relatedId && Number.isFinite(Number(transaction.amount)) && transaction.amount > 0 && toDateOrNull(transaction.createdAt)) {
      linkedReloadIds.add(transaction.relatedId)
    }
  })
  reloads.forEach(record => {
    if (record.status !== 'completed' || (storeId && record.storeId !== storeId)) return
    if (linkedReloadIds.has(record.id)) return
    add(Number(record.requestedAmount), record.verifiedAt || record.createdAt)
  })
  return totals
}
