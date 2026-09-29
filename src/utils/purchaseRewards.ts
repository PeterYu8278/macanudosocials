export interface PurchaseRewardConfig {
  perRinggit?: number
  rebatePercent?: number | null
}

export interface PurchaseReward {
  points: number
  method: 'rebatePercent' | 'perRinggit'
  rate: number
}

export interface RebateReward {
  points: number
  rate: number
}

const finiteNonNegative = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, value)
}

export const calculateRebateReward = (
  total: number,
  rebatePercent?: number | null
): RebateReward => {
  const eligibleTotal = finiteNonNegative(total) ?? 0
  const configuredRate = finiteNonNegative(rebatePercent)
  const rate = Math.min(configuredRate ?? 0, 100)

  return {
    points: Math.floor((eligibleTotal * rate) / 100),
    rate,
  }
}

export const calculatePurchaseReward = (
  total: number,
  config?: PurchaseRewardConfig
): PurchaseReward => {
  const eligibleTotal = finiteNonNegative(total) ?? 0
  const rebatePercent = finiteNonNegative(config?.rebatePercent)

  if (rebatePercent !== undefined) {
    const rebate = calculateRebateReward(eligibleTotal, rebatePercent)
    return {
      points: rebate.points,
      method: 'rebatePercent',
      rate: rebate.rate,
    }
  }

  const perRinggit = finiteNonNegative(config?.perRinggit) ?? 0
  return {
    points: Math.floor(eligibleTotal * perRinggit),
    method: 'perRinggit',
    rate: perRinggit,
  }
}
