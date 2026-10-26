import type { PointsRecord } from '../types'
import type { TFunction } from 'i18next'
import { classifyPointsRecord } from './pointsRecordClassification'

export const isHistoricalPointsRecord = (record: PointsRecord): boolean => classifyPointsRecord(record) === 'historical'

export const formatPointsRecordDescription = (record: PointsRecord, t: TFunction): string => {
  if (record.visitDisplaySummary) return t('profile.visitSessionPoints', { defaultValue: 'Lounge visit' })
  const description = record.description || ''
  const historical = isHistoricalPointsRecord(record)
  const stage = ({ 'Visit first-hour charge': 'initial', 'Visit interval charge': 'interval',
    'Visit final settlement': 'settlement', 'Visit rebate': 'rebate' } as Record<string, string>)[description]
  if (record.source === 'visit' && stage) return t(`profile.visitPointStages.${stage}`, { defaultValue: description })
  if (record.source === 'reload' && description === 'Historical reload import') {
    const amount = Number(record.amount || 0)
    return `${t('pointsConfig.records.reloadDescription', {
      amount,
      points: amount,
      defaultValue: 'Reload RM {{amount}} ({{points}} points)'
    })} (H)`
  }
  const reload = record.source === 'reload'
    ? description.trim().match(/^充值\s+([\d,.]+)\s*RM\s*\(([\d,.]+)\s*积分\)(?:\s*\(H\))?$/)
    : null
  if (reload) {
    const naturalDescription = t('pointsConfig.records.reloadDescription', { amount: reload[1], points: reload[2], defaultValue: 'Reload RM {{amount}} ({{points}} points)' })
    return historical ? `${naturalDescription} (H)` : naturalDescription
  }
  if (record.source === 'visit') {
    const rebate = description.trim().match(/^驻店消费返点\s*([\d,.]+)%\s*[（(]\s*([\d,.]+)\s*积分\s*[）)]$/)
    if (rebate) {
      return t('pointsConfig.records.visitRebateDescription', {
        rate: rebate[1],
        points: rebate[2],
        defaultValue: 'Lounge spend rebate {{rate}}% ({{points}} points)'
      })
    }
    if (description === 'Historical visit fee import') {
      return `${t('profile.visitDurationFee', { defaultValue: 'Visit duration fee' })} (H)`
    }
    const duration = description.trim().match(/^驻店(?:开始|计时)扣费\s*[（(]\s*([\d,.]+)\s*小时\s*[，,]\s*共\s*([\d,.]+)\s*积分\s*[）)](?:\s*\(H\))?$/)
    if (duration) {
      const naturalDescription = t('pointsConfig.records.visitDurationDescription', { hours: duration[1], points: duration[2], defaultValue: 'Visit duration fee ({{hours}} h, {{points}} points)' })
      return historical ? `${naturalDescription} (H)` : naturalDescription
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

  return record.visitDisplaySummary === true || record.isVisitSessionSummary === true
    || ['Visit first-hour charge', 'Visit interval charge', 'Visit final settlement'].includes(record.description)
    || record.description.startsWith('驻店开始扣费')
    || record.description.startsWith('驻店计时扣费')
    || record.description.startsWith('驻店时长费用')
    || record.description.startsWith('Day Pass 超时费用')
    || record.description === 'Historical visit fee import'
    || isDayPassPurchaseRecord(record)
}

const isVisitRebate = (record: PointsRecord): boolean => record.source === 'visit'
  && (record.description === 'Visit rebate' || record.description.startsWith('驻店消费返点'))

export const isVisitSessionPointsRecord = (record: PointsRecord): boolean => isVisitDurationRecord(record) || isVisitRebate(record)

const isCumulativeVisitSummary = (record: PointsRecord): boolean => (
  record.isVisitSessionSummary === true
  || (record.description.startsWith('驻店计时扣费') && record.description.includes('共'))
)

export const consolidateVisitPointsRecords = (
  records: PointsRecord[],
  _pendingSessionIds: ReadonlySet<string>,
  complete: boolean | ReadonlySet<string> = true
): PointsRecord[] => {
  const durationRecordsBySession = new Map<string, PointsRecord[]>()

  for (const record of records) {
    if (record.relatedId && isVisitSessionPointsRecord(record)) {
      const key = `${record.userId}:${record.relatedId}`
      const sessionRecords = durationRecordsBySession.get(key) || []
      sessionRecords.push(record)
      durationRecordsBySession.set(key, sessionRecords)
    }
  }

  const canonicalRecordBySession = new Map<string, PointsRecord>()
  for (const [sessionId, sessionRecords] of durationRecordsBySession) {
    const unique = [...new Map(sessionRecords.map(record => [record.id, record])).values()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    const actual = unique.filter(record => classifyPointsRecord(record) !== 'historical')
    const population = actual.length ? actual : unique
    const summary = population.find(isCumulativeVisitSummary)
    // A checkout summary already includes duration adjustments/refunds; rebates are additional credits.
    const included = summary ? population.filter(record => record.id === summary.id || isDayPassPurchaseRecord(record) || isVisitRebate(record)) : population
    const includedIds = new Set(included.map(record => record.id))
    const cents = (record: PointsRecord) => Number.isFinite(record.amount) && record.amount >= 0 ? Math.round(record.amount * 100) : 0
    const spend = included.filter(record => record.type === 'spend').reduce((sum, record) => sum + cents(record), 0)
    const credit = included.filter(record => record.type === 'earn').reduce((sum, record) => sum + cents(record), 0)
    const latest = summary || unique[0]
    const lastTime = new Date(unique[0].createdAt).getTime()
    const lastRows = unique.filter(record => new Date(record.createdAt).getTime() === lastTime)
    const balanceTails = lastRows.filter(record => record.balance !== undefined
      && !lastRows.some(other => other !== record && other.balanceBefore === record.balance))
    const latestBalance = balanceTails.length === 1 ? balanceTails[0].balance : summary?.balance
    canonicalRecordBySession.set(sessionId, {
      ...latest, type: spend >= credit ? 'spend' : 'earn', amount: Math.abs(spend - credit) / 100,
      createdAt: unique[0].createdAt, createdBy: unique[0].createdBy, balance: latestBalance,
      description: population.some(isDayPassPurchaseRecord) ? DAY_PASS_SUMMARY_DESCRIPTION
        : summary?.description || (unique.length > 1 ? VISIT_SUMMARY_DESCRIPTION : latest.description),
      visitDisplaySummary: true, visitGrossSpend: spend / 100, visitCredits: credit / 100,
      visitRecordsComplete: (typeof complete === 'boolean' ? complete : complete.has(sessionId)) && included.every(record => Number.isFinite(record.amount) && record.amount >= 0),
      visitBreakdown: unique.map(record => ({ id: record.id, type: record.type, amount: record.amount,
        description: record.description, createdAt: record.createdAt, includedInTotal: includedIds.has(record.id),
        historical: classifyPointsRecord(record) === 'historical', summary: isCumulativeVisitSummary(record) })),
    })
  }

  const visibleRecords: PointsRecord[] = []
  const emittedSessionIds = new Set<string>()

  for (const record of records) {
    const sessionId = isVisitSessionPointsRecord(record) && record.relatedId ? `${record.userId}:${record.relatedId}` : undefined

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
