import type { RedemptionRecord } from '../types'

export interface CigarRedemptionGroup {
  key: string
  cigarName: string
  completedQuantity: number
  pendingQuantity: number
  records: RedemptionRecord[]
}

export const groupCigarRedemptions = (records: RedemptionRecord[]): CigarRedemptionGroup[] => {
  const groups = new Map<string, CigarRedemptionGroup>()
  for (const record of records) {
    const key = record.cigarId ? `id:${record.cigarId}` : `name:${record.cigarName.trim()}`
    const group = groups.get(key) || {
      key, cigarName: record.cigarName, completedQuantity: 0, pendingQuantity: 0, records: [],
    }
    const quantity = Math.max(0, Number(record.quantity) || 0)
    if (record.status === 'completed') group.completedQuantity += quantity
    else group.pendingQuantity += quantity
    group.records.push(record)
    groups.set(key, group)
  }
  return [...groups.values()].map(group => ({
    ...group,
    records: [...group.records].sort((a, b) => b.redeemedAt.getTime() - a.redeemedAt.getTime()),
  })).sort((a, b) => b.records[0].redeemedAt.getTime() - a.records[0].redeemedAt.getTime())
}
