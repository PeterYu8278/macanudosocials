import { describe, expect, it } from 'vitest'
import type { PointsRecord } from '../types'
import { consolidateVisitPointsRecords, formatPointsRecordDescription } from './pointsRecordDisplay'
import { createInstance } from 'i18next'
import en from '../i18n/locales/en-US.json'
import zh from '../i18n/locales/zh-CN.json'

const record = (overrides: Partial<PointsRecord>): PointsRecord => ({
  id: 'record-1',
  userId: 'user-1',
  type: 'spend',
  amount: 10,
  source: 'visit',
  description: '驻店计时扣费',
  createdAt: new Date('2026-09-22T10:00:00Z'),
  ...overrides
})

describe('formatPointsRecordDescription', () => {
  it('localizes visit duration details and consolidated totals in both languages', async () => {
    const i18n = createInstance()
    await i18n.init({ lng: 'en-US', resources: { 'en-US': { translation: en }, 'zh-CN': { translation: zh } } })
    const visit = record({ description: '驻店计时扣费 (1小时，共25积分)' })
    expect(formatPointsRecordDescription(visit, i18n.t)).toBe('Visit duration fee (1 h, 25 points)')
    expect(formatPointsRecordDescription(record({ description: '驻店计时扣费（1.5小时，共37.5积分）' }), i18n.t)).toBe('Visit duration fee (1.5 h, 37.5 points)')
    expect(formatPointsRecordDescription(record({ description: '驻店计时扣费（本次驻店汇总）' }), i18n.t)).toBe('Visit duration fee (visit total)')
    await i18n.changeLanguage('zh-CN')
    expect(formatPointsRecordDescription(visit, i18n.t)).toBe('驻店计时扣费 (1小时，共25积分)')
  })

  it('does not expose translation keys when a stale resource lacks the new keys', async () => {
    const i18n = createInstance()
    await i18n.init({ lng: 'en-US', resources: { 'en-US': { translation: {} } } })
    expect(formatPointsRecordDescription(record({ source: 'reload', description: '充值 100 RM (100 积分)' }), i18n.t)).toBe('Reload RM 100 (100 points)')
    expect(formatPointsRecordDescription(record({ description: '驻店计时扣费 (1小时，共25积分)' }), i18n.t)).toBe('Visit duration fee (1 h, 25 points)')
  })

  it('localizes legacy reload descriptions when the language changes', async () => {
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: en }, zh: { translation: zh } } })
    const reload = record({ source: 'reload', description: '充值 100 RM (100 积分)' })
    expect(formatPointsRecordDescription(reload, i18n.t)).toBe('Reload RM 100 (100 points)')
    await i18n.changeLanguage('zh')
    expect(formatPointsRecordDescription(reload, i18n.t)).toBe('充值 100 RM (100 积分)')
    expect(reload.description).toBe('充值 100 RM (100 积分)')
  })

  it('localizes historical visit fee imports without changing their amount', async () => {
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: en }, zh: { translation: zh } } })
    const visitFee = record({ amount: 27, description: 'Historical visit fee import' })
    expect(formatPointsRecordDescription(visitFee, i18n.t)).toBe('Visit duration fee (H)')
    await i18n.changeLanguage('zh')
    expect(formatPointsRecordDescription(visitFee, i18n.t)).toBe('驻店计时扣费 (H)')
  })

  it('formats historical reloads like natural reloads with an H marker', async () => {
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: en }, zh: { translation: zh } } })
    const reload = record({ source: 'reload', type: 'earn', amount: 200, description: 'Historical reload import', createdBy: 'legacy_migration' })
    expect(formatPointsRecordDescription(reload, i18n.t)).toBe('Reload RM 200 (200 points) (H)')
    await i18n.changeLanguage('zh')
    expect(formatPointsRecordDescription(reload, i18n.t)).toBe('充值 200 RM (200 积分) (H)')
  })

  it('preserves the H marker on newly imported natural descriptions', async () => {
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } })
    const reload = record({ source: 'reload', type: 'earn', amount: 200, description: '充值 200 RM (200 积分) (H)', createdBy: 'legacy_migration' })
    expect(formatPointsRecordDescription(reload, i18n.t)).toBe('Reload RM 200 (200 points) (H)')
    const visit = record({ amount: 27, description: '驻店计时扣费 (1.5小时，共27积分) (H)', createdBy: 'legacy_migration' })
    expect(formatPointsRecordDescription(visit, i18n.t)).toBe('Visit duration fee (1.5 h, 27 points) (H)')
  })

  it('preserves distinct money and points amounts', async () => {
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } })
    expect(formatPointsRecordDescription(record({ source: 'reload', amount: 120, description: '充值 100.50 RM (120 积分)' }), i18n.t))
      .toBe('Reload RM 100.50 (120 points)')
  })

  it('localizes lounge spend rebate descriptions', async () => {
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: en }, zh: { translation: zh } } })
    const rebate = record({ type: 'earn', amount: 11, description: '驻店消费返点 1% (11积分)' })
    expect(formatPointsRecordDescription(rebate, i18n.t)).toBe('Lounge spend rebate 1% (11 points)')
    await i18n.changeLanguage('zh')
    expect(formatPointsRecordDescription(rebate, i18n.t)).toBe('驻店消费返点 1% (11积分)')
  })

  it('preserves custom descriptions rather than replacing them with generic text', async () => {
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: en } } })
    expect(formatPointsRecordDescription(record({ source: 'purchase', description: 'Manual correction' }), i18n.t)).toBe('Manual correction')
  })
})

describe('consolidateVisitPointsRecords', () => {
  it('shows visit deductions while their check-in session is pending', () => {
    const records = [record({ relatedId: 'pending-session' })]

    expect(consolidateVisitPointsRecords(records, new Set(['pending-session']))).toEqual(records)
  })

  it('combines legacy deductions from the same completed session', () => {
    const records = [
      record({ id: 'latest', relatedId: 'session-1', amount: 13, balance: 617 }),
      record({ id: 'older', relatedId: 'session-1', amount: 13, balance: 630 })
    ]

    expect(consolidateVisitPointsRecords(records, new Set())).toEqual([
      expect.objectContaining({
        id: 'latest',
        amount: 26,
        balance: 617,
        description: '驻店计时扣费（本次驻店汇总）'
      })
    ])
  })

  it('uses the checkout cumulative summary instead of adding earlier charges again', () => {
    const records = [
      record({
        id: 'checkout-summary',
        relatedId: 'session-1',
        amount: 62.5,
        balance: 528.5,
        description: '驻店计时扣费 (2.5小时，共62.5积分)',
        isVisitSessionSummary: true
      }),
      record({
        id: 'initial-charge',
        relatedId: 'session-1',
        amount: 25,
        balance: 566,
        description: '驻店开始扣费 (1小时 × 25积分)'
      })
    ]

    expect(consolidateVisitPointsRecords(records, new Set())).toEqual([
      expect.objectContaining({
        id: 'checkout-summary',
        amount: 62.5,
        balance: 528.5
      })
    ])
  })

  it('combines Day Pass purchase and overtime into one visible spend record', () => {
    const records = [
      record({
        id: 'overtime',
        relatedId: 'day-pass-session',
        amount: 60,
        balance: 420,
        description: 'Day Pass 超时费用 (总5h, 免3h, 超时费30/h)'
      }),
      record({
        id: 'purchase',
        relatedId: 'day-pass-session',
        amount: 100,
        balance: 480,
        description: '购买 Day Pass'
      })
    ]

    expect(consolidateVisitPointsRecords(records, new Set())).toEqual([
      expect.objectContaining({
        id: 'overtime',
        amount: 160,
        balance: 420,
        description: 'Day Pass 驻店消费合计'
      })
    ])
  })

  it('keeps the visit rebate separate from the combined Day Pass spend', () => {
    const rebate = record({
      id: 'rebate',
      relatedId: 'day-pass-session',
      type: 'earn',
      amount: 18,
      description: '驻店消费返点 30% (18积分)'
    })
    const records = [
      rebate,
      record({
        id: 'overtime',
        relatedId: 'day-pass-session',
        amount: 60,
        description: 'Day Pass 超时费用 (总5h, 免3h, 超时费30/h)'
      }),
      record({
        id: 'purchase',
        relatedId: 'day-pass-session',
        amount: 100,
        description: '购买 Day Pass'
      })
    ]

    const consolidated = consolidateVisitPointsRecords(records, new Set())
    expect(consolidated).toHaveLength(2)
    expect(consolidated[0]).toBe(rebate)
    expect(consolidated[1]).toEqual(expect.objectContaining({ amount: 160 }))
  })

  it('does not merge unrelated visit charges that share a related id', () => {
    const records = [
      record({ id: 'deposit', relatedId: 'booking-1', amount: 50, description: '房间预订订金' }),
      record({ id: 'balance', relatedId: 'booking-1', amount: 50, description: '包厢签到扣除余款' })
    ]

    expect(consolidateVisitPointsRecords(records, new Set())).toHaveLength(2)
  })

  it('keeps deductions from different sessions separate', () => {
    const records = [
      record({ id: 'session-1-record', relatedId: 'session-1' }),
      record({ id: 'session-2-record', relatedId: 'session-2' })
    ]

    expect(consolidateVisitPointsRecords(records, new Set())).toHaveLength(2)
  })
})
