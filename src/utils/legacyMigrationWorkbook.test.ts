import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { analyzeLegacyMigrationWorkbook, normalizeLegacyPhone, prepareLegacyMigrationWorkbook } from './legacyMigrationWorkbook'

const workbookBuffer = () => {
  const workbook = XLSX.utils.book_new()
  const add = (name: string, rows: unknown[][]) => {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name)
  }

  add('User', [
    ['M SOCIALS MY'],
    ['#', 'NAME', 'EMAIL', 'PHONE NUMBER', 'FRIENDS INVITE', 'STATUS'],
    [1, 'Member One', 'one@example.com', '0123456789', 2, 'available'],
    [2, 'Member One Duplicate', 'one@example.com', '0123456789', 0, 'pending'],
    [3, 'Deleted Member', 'deleted@example.com', '0199999999', 0, 'delete'],
  ])
  add('member', [
    ['M SOCIALS MY'],
    ['#', 'NAME', 'EMAIL', 'PHONE NUMBER', 'TOTAL SPEND', 'TOTAL RELOAD (RM)', 'BALANCE RELOAD', 'LAST CHECK IN'],
    [1, 'Member One', 'one@example.com', '0123456789', '01 Hours and 00 Minutes', 100, 80, new Date('2026-01-01')],
  ])
  add('Check In', [
    ['M SOCIALS MY'],
    ['#', 'PHONE NUMBER', 'TIME START', 'TIME END', 'LOUNGE', 'STATUS'],
    [1, '0123456789', new Date('2026-01-01T10:00:00Z'), new Date('2026-01-01T11:00:59Z'), 'Main Lounge', 'Successful'],
    [2, '0199999999', new Date('2026-01-01T10:15:00Z'), new Date('2026-01-01T10:45:00Z'), 'Main Lounge', 'Successful'],
  ])
  add('FEE MEMBER', [
    ['M SOCIALS MY'],
    ['#', 'NAME', 'PHONE NUMBER', 'TIME REQUEST', 'PRICE (RM)', 'LOUNGE', 'STATUS'],
    [1, 'Member One', '0123456789', new Date('2026-01-01'), 199, 'Main Lounge', 'Successful'],
  ])
  add('reload', [
    ['M SOCIALS MY'],
    ['#', 'NAME', 'EMAIL', 'PHONE NUMBER', 'RELOAD (RM)', 'LOUNGE', 'DATE::TIME'],
    [1, 'Member One', 'one@example.com', '0123456789', 100, 'Main Lounge', new Date('2026-01-01')],
    [2, 'No Snapshot', 'other@example.com', '0188888888', 50, 'Main Lounge', new Date('2026-01-02')],
  ])
  add('Redemption', [
    ['M SOCIALS MY'],
    ['#', 'NAME', 'PHONE NUMBER', 'TIME REQUEST', 'CIGAR', 'LOUNGE', 'STATUS'],
    [1, 'Member One', '0123456789', new Date('2026-01-01T10:30:00Z'), 'First', 'Main Lounge', 'Successful'],
  ])

  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

const v2WorkbookBuffer = () => {
  const workbook = XLSX.utils.book_new()
  const add = (name: string, rows: unknown[][]) => {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name)
  }
  add('member', [
    ['#', 'NAME', 'EMAIL', 'PHONE NUMBER', 'TOTAL SPEND', 'TOTAL RELOAD (RM)', 'Referral', 'BALANCE RELOAD', 'LAST CHECK IN', 'Lounge', 'Membership', 'Activation Date'],
    [1, 'Member One', 'one@example.com', 60123456789, '02 Hours and 00 Minutes', 100, 2, 80, new Date('2026-01-02'), 'Main Lounge', 199, new Date('2026-01-01')],
  ])
  add('reload', [
    ['#', 'NAME', 'EMAIL', 'PHONE NUMBER', 'RELOAD (RM)', 'LOUNGE', 'Reload Time Stamp'],
    [1, 'Member One', 'one@example.com', 60123456789, 100, 'Main Lounge', new Date('2026-01-01')],
  ])
  add('Check In', [
    ['#', null, 'PHONENUMBER', 'TIME START', 'TIME END', 'Duration', 'Duration', 'STATUS', 'Fee (RM)'],
    [1, 'Member One', 60123456789, new Date('2026-01-01T10:00:00Z'), new Date('2026-01-01T11:00:59Z'), '01:00', 'Main Lounge', 'Successful', 18],
    [2, 'Member One', 60123456789, new Date('2026-01-02T10:00:00Z'), new Date('2026-01-04T10:00:00Z'), '2 days', 'Main Lounge', 'Successful', 864],
  ])
  add('Redemption', [
    ['#', 'NAME', 'PHONE NUMBER', 'TIME REQUEST', 'CIGAR', 'LOUNGE', 'STATUS'],
    [1, 'Member One', 60123456789, new Date('2026-01-01T10:30:00Z'), 'First', 'Main Lounge', 'Successful'],
  ])
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('legacyMigrationWorkbook', () => {
  it('normalizes Malaysian phone numbers', () => {
    expect(normalizeLegacyPhone('012-345 6789')).toBe('+60123456789')
    expect(normalizeLegacyPhone('60123456789')).toBe('+60123456789')
    expect(normalizeLegacyPhone('1')).toBeUndefined()
  })

  it('produces a side-effect-free migration report', () => {
    const report = analyzeLegacyMigrationWorkbook(workbookBuffer(), 'legacy.xlsx')

    expect(report.sheets.missing).toEqual([])
    expect(report.users.totalRows).toBe(3)
    expect(report.users.duplicateIdentityRows).toBe(1)
    expect(report.users.archivedWithHistory).toBe(1)
    expect(report.referrals.placeholderCount).toBe(2)
    expect(report.wallet.reloadAmount).toBe(150)
    expect(report.wallet.usersRequiringBalanceReview).toBe(1)
    expect(report.visits.completedMinutes).toBe(90)
    expect(report.referrals.coVisitCandidatePairs).toBe(1)
    expect(report.redemptions.unresolvedCigarRows).toBe(1)
  })

  it('prepares normalized stage payloads and removes exact duplicate users', () => {
    const prepared = prepareLegacyMigrationWorkbook(workbookBuffer(), 'legacy.xlsx')

    expect(prepared.payload.users).toHaveLength(2)
    expect(prepared.payload.users[0]).toMatchObject({
      email: 'one@example.com',
      phone: '+60123456789',
      referralCount: 2,
      walletBalance: 80,
      legacyVisitMinutes: 60,
    })
    expect(prepared.payload.reloads).toHaveLength(2)
    expect(prepared.payload.memberships).toHaveLength(1)
    expect(prepared.payload.visits[0].durationMinutes).toBe(60)
    expect(prepared.payload.redemptions[0].cigar).toBe('First')
  })

  it('supports the four-sheet v2 workbook and derives users and memberships from member', () => {
    const prepared = prepareLegacyMigrationWorkbook(v2WorkbookBuffer(), 'Macanudo Social.xlsx')

    expect(prepared.report.format).toBe('v2')
    expect(prepared.report.sheets.missing).toEqual([])
    expect(prepared.report.users.readyForAuth).toBe(1)
    expect(prepared.payload.users[0]).toMatchObject({
      phone: '+60123456789',
      referralCount: 2,
      legacyVisitMinutes: 120,
      resolvedVisitMinutes: 2940,
      visitCarryForwardMinutes: 0,
      sourceLounge: 'Main Lounge',
      membershipIsActive: true,
    })
    expect(prepared.payload.reloads[0].occurredAt).toBeTruthy()
    expect(prepared.payload.memberships[0]).toMatchObject({ amount: 199, sourceStatus: 'successful' })
    expect(prepared.payload.visits).toHaveLength(2)
    expect(prepared.payload.visits[0]).toMatchObject({ lounge: 'Main Lounge', durationMinutes: 60, legacyFeeRm: 18 })
    expect(prepared.payload.visits[1].durationMinutes).toBe(2880)
    expect(prepared.report.visits.anomalousDurationRows).toBe(0)
  })
})
