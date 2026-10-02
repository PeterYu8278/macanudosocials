export interface LegacyRedemptionEntry {
  id: string
  cigarId: string
  cigarName?: string
  quantity: number
  status: string
  [key: string]: unknown
}

export interface LegacyRedemptionTotal {
  cigarId: string
  cigarName: string
  quantity: number
}

export const mergeLegacyRedemptionEntries = <T extends LegacyRedemptionEntry>(
  existing: T[],
  incoming: T
): { redemptions: T[]; totals: LegacyRedemptionTotal[] } => {
  const redemptions = [...existing.filter(entry => entry.id !== incoming.id), incoming]
  const totals = new Map<string, LegacyRedemptionTotal>()

  redemptions
    .filter(entry => entry.status === 'completed')
    .forEach(entry => {
      const cigarId = String(entry.cigarId || '').trim()
      const quantity = Math.max(0, Number(entry.quantity || 0))
      if (!cigarId || quantity <= 0) return
      const current = totals.get(cigarId)
      totals.set(cigarId, {
        cigarId,
        cigarName: String(entry.cigarName || current?.cigarName || cigarId),
        quantity: (current?.quantity || 0) + quantity,
      })
    })

  return { redemptions, totals: [...totals.values()] }
}
