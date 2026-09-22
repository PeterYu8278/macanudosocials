export const REDEMPTION_COOLDOWN_SECONDS = 60 * 60

type TimestampLike = {
  toDate?: () => Date
  seconds?: number
}

type RedemptionTimeRecord = {
  redeemedAt?: Date | string | number | TimestampLike
}

const toMillis = (value: RedemptionTimeRecord['redeemedAt']): number | null => {
  if (value == null) return null
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') return value.toDate().getTime()
    if (typeof value.seconds === 'number') return value.seconds * 1000
  }

  const millis = new Date(value as string | number).getTime()
  return Number.isFinite(millis) ? millis : null
}

export const getRedemptionCooldownSeconds = (
  records: RedemptionTimeRecord[],
  now: Date | number = Date.now()
): number => {
  const nowMillis = now instanceof Date ? now.getTime() : now
  const latestMillis = records.reduce<number | null>((latest, record) => {
    const millis = toMillis(record.redeemedAt)
    return millis != null && (latest == null || millis > latest) ? millis : latest
  }, null)

  if (latestMillis == null) return 0

  const elapsedSeconds = Math.floor((nowMillis - latestMillis) / 1000)
  return Math.max(0, REDEMPTION_COOLDOWN_SECONDS - elapsedSeconds)
}
