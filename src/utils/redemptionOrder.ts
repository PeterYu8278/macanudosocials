import type { RedemptionRecordItem } from '../types'

export interface AggregatedRedemption {
  cigarId: string
  cigarName: string
  quantity: number
}

export const areRedemptionsReadyForSettlement = (
  records: Array<Pick<RedemptionRecordItem, 'status'>>
): boolean => records.length > 0 && records.every(record => record.status === 'completed')

export const aggregateCompletedRedemptions = (
  records: Array<Pick<RedemptionRecordItem, 'cigarId' | 'cigarName' | 'quantity' | 'status'>>
): AggregatedRedemption[] => {
  const totals = new Map<string, AggregatedRedemption>()

  for (const record of records) {
    const cigarId = record.cigarId?.trim()
    if (record.status !== 'completed' || !cigarId || !Number.isFinite(record.quantity) || record.quantity <= 0) {
      continue
    }

    const existing = totals.get(cigarId)
    if (existing) {
      existing.quantity += record.quantity
    } else {
      totals.set(cigarId, {
        cigarId,
        cigarName: record.cigarName,
        quantity: record.quantity
      })
    }
  }

  return [...totals.values()]
}
