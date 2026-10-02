export const getRedemptionOrderMonth = (date: Date) => {
  const year = date.getFullYear()
  const month = date.getMonth()
  return {
    prefix: `ORD-${year}-${String(month + 1).padStart(2, '0')}-`,
    start: new Date(year, month, 1, 0, 0, 0, 0),
    end: new Date(year, month + 1, 0, 23, 59, 59, 999),
  }
}

export const resolveRedemptionOrderId = async ({
  date, existingId, getMonthlyCount, exists,
}: {
  date: Date
  existingId?: string
  getMonthlyCount: () => Promise<number>
  exists: (id: string) => Promise<boolean>
}) => {
  if (existingId) return existingId
  const { prefix } = getRedemptionOrderMonth(date)
  let sequence = await getMonthlyCount() + 1
  let id = `${prefix}${String(sequence).padStart(4, '0')}-R`
  while (await exists(id)) {
    sequence += 1
    id = `${prefix}${String(sequence).padStart(4, '0')}-R`
  }
  return id
}
