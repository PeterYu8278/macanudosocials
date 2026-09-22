import type { PointsRecord } from '../types'

const VISIT_SUMMARY_DESCRIPTION = '驻店计时扣费（本次驻店汇总）'

export const consolidateVisitPointsRecords = (
  records: PointsRecord[],
  pendingSessionIds: ReadonlySet<string>
): PointsRecord[] => {
  const visibleRecords: PointsRecord[] = []
  const visitRecordsBySession = new Map<string, PointsRecord>()

  for (const record of records) {
    const sessionId = record.source === 'visit' ? record.relatedId : undefined

    if (!sessionId) {
      visibleRecords.push(record)
      continue
    }

    if (pendingSessionIds.has(sessionId)) {
      continue
    }

    const existing = visitRecordsBySession.get(sessionId)
    if (existing) {
      existing.amount += record.amount
      existing.description = VISIT_SUMMARY_DESCRIPTION
      continue
    }

    const consolidatedRecord = { ...record }
    visitRecordsBySession.set(sessionId, consolidatedRecord)
    visibleRecords.push(consolidatedRecord)
  }

  return visibleRecords
}
