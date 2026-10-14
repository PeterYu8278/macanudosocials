import { describe, expect, it } from 'vitest'
import type { MembershipFeeRecord, PointsRecord, ReloadRecord, User, VisitSession } from '../types'
import { balanceReportRows, membershipFeeReportRows, pointsReportRows, reloadReportRows, visitReportRows, type ReportRecord } from './walletReports'

const user = { id: 'u', displayName: 'Member', memberId: 'ABC123', email: 'member@example.com', profile: { phone: '+60123456789' }, membership: { points: 80 } } as User
const point = (id: string, overrides: Partial<ReportRecord<PointsRecord>> = {}): ReportRecord<PointsRecord> => ({
  id, userId: 'u', type: 'earn', source: 'reload', amount: 100, description: 'Reload', createdAt: new Date('2026-10-01'), ...overrides,
})

describe('wallet report reconciliation', () => {
  it('keeps raw historical and cumulative records but excludes them from live transaction totals', () => {
    const records = [point('credit', { balance: 100 }),
      point('debit', { type: 'spend', amount: 20, source: 'visit', balance: 80, createdAt: new Date('2026-10-02') }),
      point('summary', { type: 'spend', amount: 20, source: 'visit', balance: 80, isVisitSessionSummary: true, createdAt: new Date('2026-10-03') }),
      point('legacy', { amount: 1000, balance: 1000, migration: { source: 'legacy_workbook', batchId: 'batch' }, createdAt: new Date('2026-10-04') }),
    ]
    expect(pointsReportRows(records, [user])).toHaveLength(4)
    expect(pointsReportRows(records, [user]).find(record => record['Record ID'] === 'legacy')?.['Wallet Effect']).toBe('Historical only')
    expect(balanceReportRows([user], records)[0]).toMatchObject({
      'Historical Records Excluded': 1, 'Summary Records Excluded': 1,
      'Recorded Live Credits': 100, 'Recorded Live Debits': 20,
      'Expected From Checkpoint': 80, Difference: 0, 'Reconciliation Status': 'Matches checkpoint',
    })
  })
  it('does not invent a zero opening balance when no checkpoint exists', () => {
    expect(balanceReportRows([user], [point('no-balance')])[0]).toMatchObject({
      'Expected From Checkpoint': '-', Difference: '-', 'Reconciliation Status': 'No balance checkpoint',
    })
  })
  it('applies newer transactions after the latest checkpoint and reports differences', () => {
    const records = [point('anchor', { balance: 100 }), point('later', { type: 'spend', amount: 20, createdAt: new Date('2026-10-02') })]
    const changed = { ...user, membership: { level: 'bronze' as const, points: 79 } }
    expect(balanceReportRows([changed], records)[0]).toMatchObject({
      'Expected From Checkpoint': 80, Difference: -1, 'Reconciliation Status': 'Difference - review required',
    })
  })
  it('marks conflicting same-time checkpoints as ambiguous instead of selecting an arbitrary ID', () => {
    const records = [point('a', { balance: 100 }), point('b', { type: 'spend', amount: 20, balance: 80 })]
    expect(balanceReportRows([user], records)[0]).toMatchObject({
      'Expected From Checkpoint': '-', 'Reconciliation Status': 'Ambiguous checkpoint timestamp',
    })
  })
  it('requires review for an undated or malformed live ledger', () => {
    expect(balanceReportRows([user], [point('anchor', { balance: 80 }), point('bad', { createdAt: new Date('invalid') })])[0]
      ['Reconciliation Status']).toBe('Invalid or undated ledger')
  })
  it('retains orphan user records without inventing a wallet balance', () => {
    expect(balanceReportRows([], [point('orphan', { balance: 80, userName: 'Former Member' })])[0]).toMatchObject({
      Name: 'Former Member', 'Current Wallet Points': '-', 'Reconciliation Status': 'User missing',
    })
  })
  it('does not let a historical-only flag become an extra wallet credit', () => {
    const records = [point('anchor', { balance: 80 }), point('old', { migration: { balanceNotApplied: true } })]
    expect(balanceReportRows([user], records)[0]['Historical Records Excluded']).toBe(1)
  })
})

describe('detailed member report worksheets', () => {
  it('includes pending and historical reloads and preserves missing actual payment amounts', () => {
    const records = [{ id: 'r', userId: 'u', requestedAmount: 299, pointsEquivalent: 299, status: 'pending',
      createdAt: new Date('2026-10-01'), migration: { source: 'legacy_workbook', batchId: 'old' } } as ReportRecord<ReloadRecord>]
    expect(reloadReportRows(records, [user])[0]).toMatchObject({ Name: 'Member', Phone: '+60123456789',
      Status: 'pending', 'Recorded Received Amount (RM)': '-', 'Historical Import': 'Yes', 'Migration Batch': 'old' })
  })
  it('includes paid and scheduled fee records without substituting creation time for deduction time', () => {
    const record = { id: 'fee', userId: 'u', renewalType: 'renewal', amount: 199, status: 'pending', dueDate: new Date('2027-10-01'), createdAt: new Date('2026-10-01') } as MembershipFeeRecord
    expect(membershipFeeReportRows([record], [user])[0]).toMatchObject({ Type: 'renewal', Status: 'pending', 'Actual Deducted At': '-', 'Fee Amount (Points)': 199 })
    expect(membershipFeeReportRows([{ ...record, status: 'paid', deductedAt: new Date('2026-10-01') }], [user])[0]['Actual Deducted At']).not.toBe('-')
  })
  it('separates total and realtime visit deductions and preserves unknown fees versus explicit zero', () => {
    const record = { id: 'session', userId: 'u', storeId: 'lounge', checkInAt: new Date('2026-10-01'),
      status: 'completed', durationMinutes: 60, durationHours: 1, realtimePointsDeducted: 18 } as VisitSession
    expect(visitReportRows([record], [user])[0]).toMatchObject({ 'Recorded Points Deducted': '-', 'Realtime Points Deducted': 18, 'Duration Hours': 1 })
    expect(visitReportRows([{ ...record, pointsDeducted: 0 }], [user])[0]['Recorded Points Deducted']).toBe(0)
  })
})
