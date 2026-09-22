import type { PointsRecord } from '../types'

const VISIT_SUMMARY_DESCRIPTION = '驻店计时扣费（本次驻店汇总）'

const isVisitDurationRecord = (record: PointsRecord): boolean => {
  if (record.source !== 'visit') return false

  return record.isVisitSessionSummary === true
    || record.description.startsWith('驻店开始扣费')
    || record.description.startsWith('驻店计时扣费')
    || record.description.startsWith('驻店时长费用')
    || record.description.startsWith('Day Pass 超时费用')
}

const isCumulativeVisitSummary = (record: PointsRecord): boolean => (
  record.isVisitSessionSummary === true
  || (record.description.startsWith('驻店计时扣费') && record.description.includes('共'))
)

export const consolidateVisitPointsRecords = (
  records: PointsRecord[],
  pendingSessionIds: ReadonlySet<string>
): PointsRecord[] => {
  const durationRecordsBySession = new Map<string, PointsRecord[]>()

  for (const record of records) {
    if (record.relatedId && isVisitDurationRecord(record)) {
      const sessionRecords = durationRecordsBySession.get(record.relatedId) || []
      sessionRecords.push(record)
      durationRecordsBySession.set(record.relatedId, sessionRecords)
    }
  }

  const canonicalRecordBySession = new Map<string, PointsRecord>()
  for (const [sessionId, sessionRecords] of durationRecordsBySession) {
    const summary = sessionRecords.find(isCumulativeVisitSummary)
    if (summary) {
      canonicalRecordBySession.set(sessionId, summary)
      continue
    }

    const [latest, ...older] = sessionRecords
    canonicalRecordBySession.set(sessionId, {
      ...latest,
      amount: older.reduce((total, record) => total + record.amount, latest.amount),
      description: sessionRecords.length > 1 ? VISIT_SUMMARY_DESCRIPTION : latest.description
    })
  }

  const visibleRecords: PointsRecord[] = []
  const emittedSessionIds = new Set<string>()

  for (const record of records) {
    const sessionId = isVisitDurationRecord(record) ? record.relatedId : undefined

    if (!sessionId) {
      visibleRecords.push(record)
      continue
    }

    if (pendingSessionIds.has(sessionId)) {
      continue
    }

    if (emittedSessionIds.has(sessionId)) {
      continue
    }

    const canonicalRecord = canonicalRecordBySession.get(sessionId)
    if (canonicalRecord) visibleRecords.push(canonicalRecord)
    emittedSessionIds.add(sessionId)
  }

  return visibleRecords
}
