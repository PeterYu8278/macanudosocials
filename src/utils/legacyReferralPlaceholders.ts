export interface LegacyReferralEntry {
  userId: string
  userName?: string
  memberId?: string
  isPlaceholder?: boolean
  placeholderStatus?: 'unresolved' | 'resolved'
  placeholderIndex?: number
  source?: string
  [key: string]: unknown
}

export const addUnknownReferralEntries = <T extends LegacyReferralEntry>(
  existing: T[],
  targetCount: number,
  idForIndex: (index: number) => string
): { referrals: Array<T | LegacyReferralEntry>; created: LegacyReferralEntry[] } => {
  const safeTarget = Math.max(0, Math.floor(Number(targetCount) || 0))
  const referrals: Array<T | LegacyReferralEntry> = [...existing]
  const created: LegacyReferralEntry[] = []

  for (let index = referrals.length; index < safeTarget; index += 1) {
    const placeholder: LegacyReferralEntry = {
      userId: idForIndex(index),
      isPlaceholder: true,
      placeholderStatus: 'unresolved',
      placeholderIndex: index + 1,
      source: 'legacy_workbook',
    }
    referrals.push(placeholder)
    created.push(placeholder)
  }

  return { referrals, created }
}
