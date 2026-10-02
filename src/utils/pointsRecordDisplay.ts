import type { PointsRecord } from '../types'
import type { TFunction } from 'i18next'

export const formatPointsRecordDescription = (record: PointsRecord, t: TFunction): string => {
  const description = record.description || ''
  const reload = record.source === 'reload'
    ? description.trim().match(/^充值\s+([\d,.]+)\s*RM\s*\(([\d,.]+)\s*积分\)$/)
    : null
  if (reload) {
    return t('pointsConfig.records.reloadDescription', { amount: reload[1], points: reload[2], defaultValue: 'Reload RM {{amount}} ({{points}} points)' })
  }
  if (record.source === 'visit') {
    const duration = description.trim().match(/^驻店(?:开始|计时)扣费\s*[（(]\s*([\d,.]+)\s*小时\s*[，,]\s*共\s*([\d,.]+)\s*积分\s*[）)]$/)
    if (duration) {
      return t('pointsConfig.records.visitDurationDescription', { hours: duration[1], points: duration[2], defaultValue: 'Visit duration fee ({{hours}} h, {{points}} points)' })
    }
    if (description === '驻店计时扣费（本次驻店汇总）') {
      return t('pointsConfig.records.visitSummaryDescription', { defaultValue: 'Visit duration fee (visit total)' })
    }
    if (description === '驻店计时扣费') {
      return t('pointsConfig.records.sources.visit', { defaultValue: 'Visit duration fee' })
    }
  }
  return description || '-'
}

const VISIT_SUMMARY_DESCRIPTION = '驻店计时扣费（本次驻店汇总）'
const DAY_PASS_SUMMARY_DESCRIPTION = 'Day Pass 驻店消费合计'

const isDayPassPurchaseRecord = (record: PointsRecord): boolean => (
  record.source === 'visit'
  && record.type === 'spend'
  && record.description.startsWith('购买 Day Pass')
)

export const isVisitDurationRecord = (record: PointsRecord): boolean => {
  if (record.source !== 'visit') return false

  return record.isVisitSessionSummary === true
    || record.description.startsWith('驻店开始扣费')
    || record.description.startsWith('驻店计时扣费')
    || record.description.startsWith('驻店时长费用')
    || record.description.startsWith('Day Pass 超时费用')
    || isDayPassPurchaseRecord(record)
}

const isCumulativeVisitSummary = (record: PointsRecord): boolean => (
  record.isVisitSessionSummary === true
  || (record.description.startsWith('驻店计时扣费') && record.description.includes('共'))
)

export const consolidateVisitPointsRecords = (
  records: PointsRecord[],
  _pendingSessionIds: ReadonlySet<string>
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
    const dayPassPurchaseTotal = sessionRecords
      .filter(isDayPassPurchaseRecord)
      .reduce((total, record) => total + record.amount, 0)
    if (summary) {
      canonicalRecordBySession.set(sessionId, dayPassPurchaseTotal > 0 ? {
        ...summary,
        amount: summary.amount + dayPassPurchaseTotal,
        description: DAY_PASS_SUMMARY_DESCRIPTION
      } : summary)
      continue
    }

    const [latest, ...older] = sessionRecords
    canonicalRecordBySession.set(sessionId, {
      ...latest,
      amount: older.reduce((total, record) => total + record.amount, latest.amount),
      description: dayPassPurchaseTotal > 0 && sessionRecords.length > 1
        ? DAY_PASS_SUMMARY_DESCRIPTION
        : sessionRecords.length > 1
          ? VISIT_SUMMARY_DESCRIPTION
          : latest.description
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

    if (emittedSessionIds.has(sessionId)) {
      continue
    }

    const canonicalRecord = canonicalRecordBySession.get(sessionId)
    if (canonicalRecord) visibleRecords.push(canonicalRecord)
    emittedSessionIds.add(sessionId)
  }

  return visibleRecords
}
