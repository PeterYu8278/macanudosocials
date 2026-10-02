import * as XLSX from 'xlsx'

export type LegacyMigrationIssueSeverity = 'error' | 'warning' | 'info'

export interface LegacyMigrationIssue {
  severity: LegacyMigrationIssueSeverity
  code: string
  message: string
  sheet?: string
  row?: number
}

export interface LegacyMigrationWorkbookReport {
  fileName: string
  format: 'v1' | 'v2'
  sheets: {
    found: string[]
    missing: string[]
  }
  users: {
    totalRows: number
    available: number
    pending: number
    deleted: number
    readyForAuth: number
    invalidIdentity: number
    duplicateIdentityRows: number
    archivedWithHistory: number
  }
  referrals: {
    placeholderCount: number
    referrerCount: number
    coVisitCandidatePairs: number
    repeatedCoVisitPairs: number
  }
  wallet: {
    snapshotUsers: number
    reloadRows: number
    reloadAmount: number
    usersRequiringBalanceReview: number
  }
  membership: {
    successfulRows: number
    rejectedRows: number
    successfulUsers: number
  }
  visits: {
    successfulRows: number
    rejectedRows: number
    multipleRequestRows: number
    completedMinutes: number
    duplicateSuccessfulRows: number
    anomalousDurationRows: number
  }
  redemptions: {
    successfulRows: number
    rejectedRows: number
    multipleRequestRows: number
    unresolvedCigarRows: number
  }
  lounges: string[]
  issues: LegacyMigrationIssue[]
}

export interface LegacyMigrationUserRow {
  sourceRow: number
  name: string
  email: string
  phone: string
  sourceStatus: 'available' | 'pending' | 'delete'
  referralCount: number
  walletBalance?: number
  totalReload?: number
  legacyVisitMinutes?: number
  resolvedVisitMinutes?: number
  visitCarryForwardMinutes?: number
  sourceLounge?: string
  membershipActiveFrom?: string
  membershipActiveUntil?: string
  membershipIsActive?: boolean
}

export interface LegacyMigrationBusinessRow {
  sourceRow: number
  name: string
  phone: string
  lounge: string
  occurredAt: string
}

export interface LegacyMigrationPayload {
  users: LegacyMigrationUserRow[]
  reloads: Array<LegacyMigrationBusinessRow & { email?: string; amount: number }>
  memberships: Array<LegacyMigrationBusinessRow & { amount: number; sourceStatus: 'successful' | 'reject' }>
  visits: Array<LegacyMigrationBusinessRow & { endedAt: string; durationMinutes: number; legacyFeeRm?: number }>
  redemptions: Array<LegacyMigrationBusinessRow & { cigar: string }>
}

export interface PreparedLegacyMigrationWorkbook {
  report: LegacyMigrationWorkbookReport
  payload: LegacyMigrationPayload
}

type SheetRow = Record<string, unknown> & { __row: number }

const REQUIRED_SHEETS_V1 = ['User', 'member', 'Check In', 'FEE MEMBER', 'reload', 'Redemption']
const REQUIRED_SHEETS_V2 = ['member', 'Check In', 'reload', 'Redemption']

const text = (value: unknown) => String(value ?? '').trim()
const lower = (value: unknown) => text(value).toLowerCase()
const numberValue = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const durationMinutes = (value: unknown) => {
  const raw = text(value)
  const hours = Number(raw.match(/(\d+(?:\.\d+)?)\s*Hours?/i)?.[1] || 0)
  const minutes = Number(raw.match(/(\d+)\s*Minutes?/i)?.[1] || 0)
  return Math.floor(hours * 60 + minutes)
}

const formatDuration = (minutes: number) => `${Math.floor(minutes / 60)} hours ${minutes % 60} mins`

const addOneYear = (date: Date) => {
  const result = new Date(date)
  result.setFullYear(result.getFullYear() + 1)
  return result
}

export const normalizeLegacyPhone = (value: unknown): string | undefined => {
  let raw = text(value)
  if (!raw || raw === '-') return undefined
  if (/^\d+\.0+$/.test(raw)) raw = raw.replace(/\.0+$/, '')
  const digits = raw.replace(/\D/g, '')
  if (!digits) return undefined

  const normalized = digits.startsWith('60')
    ? `+${digits}`
    : digits.startsWith('0')
      ? `+60${digits.slice(1)}`
      : `+60${digits}`

  return /^\+\d{8,15}$/.test(normalized) ? normalized : undefined
}

export const normalizeLegacyEmail = (value: unknown): string | undefined => {
  const normalized = lower(value)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined
}

const asDate = (value: unknown): Date | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S))
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return undefined
}

const getRows = (workbook: XLSX.WorkBook, sheetName: string): SheetRow[] => {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null })
  const headerIndex = matrix.findIndex(row => row.some(value => {
    const normalized = lower(value).replace(/\s/g, '')
    return ['name', 'phonenumber', 'timestart'].includes(normalized)
  }))
  if (headerIndex < 0) return []
  const headerCounts = new Map<string, number>()
  const headers = matrix[headerIndex].map((value, column) => {
    const base = text(value).toUpperCase() || `__COL_${column + 1}`
    const count = (headerCounts.get(base) || 0) + 1
    headerCounts.set(base, count)
    return count === 1 ? base : `${base}__${count}`
  })
  return matrix.slice(headerIndex + 1).map((values, index) => {
    const row = { __row: headerIndex + index + 2 } as SheetRow
    headers.forEach((header, column) => {
      if (header) row[header] = values[column]
    })
    return row
  }).filter(row => Object.keys(row).some(key => key !== '__row' && row[key] !== null && row[key] !== ''))
}

const phoneValue = (row: SheetRow) => row['PHONE NUMBER'] ?? row.PHONENUMBER
const nameValue = (row: SheetRow) => row.NAME ?? row.__COL_2
const loungeValue = (row: SheetRow) => row.LOUNGE ?? row.DURATION__2

const canonicalizeCheckInRows = (rows: SheetRow[]): SheetRow[] => rows.map(row => ({
  ...row,
  NAME: nameValue(row),
  'PHONE NUMBER': phoneValue(row),
  LOUNGE: loungeValue(row),
}) as SheetRow)

const isV2Workbook = (workbook: XLSX.WorkBook) => (
  !workbook.SheetNames.includes('User')
  && workbook.SheetNames.includes('member')
  && getRows(workbook, 'member').some(row => row['ACTIVATION DATE'] !== undefined)
)

const statusCount = (rows: SheetRow[], status: string) => rows.filter(row => lower(row.STATUS) === status).length

const identityPhones = (rows: SheetRow[]) => new Set(
  rows.map(row => normalizeLegacyPhone(phoneValue(row))).filter((value): value is string => !!value)
)

const addDuplicateIssues = (
  rows: SheetRow[],
  issues: LegacyMigrationIssue[],
  duplicateRows: Set<number>,
  field: 'PHONE NUMBER' | 'EMAIL',
  normalizer: (value: unknown) => string | undefined,
  sheetName = 'User',
) => {
  const matches = new Map<string, SheetRow[]>()
  rows.forEach(row => {
    const value = normalizer(field === 'PHONE NUMBER' ? phoneValue(row) : row[field])
    if (!value) return
    matches.set(value, [...(matches.get(value) || []), row])
  })
  matches.forEach((duplicates, value) => {
    if (duplicates.length < 2) return
    duplicates.slice(1).forEach(row => duplicateRows.add(row.__row))
    issues.push({
      severity: 'error',
      code: field === 'EMAIL' ? 'DUPLICATE_EMAIL' : 'DUPLICATE_PHONE',
      message: `${value} appears in ${sheetName} rows ${duplicates.map(row => row.__row).join(', ')}`,
      sheet: sheetName,
      row: duplicates[0].__row,
    })
  })
}

export const analyzeLegacyMigrationWorkbook = (
  data: ArrayBuffer | Uint8Array,
  fileName = 'workbook.xlsx',
): LegacyMigrationWorkbookReport => {
  const workbook = XLSX.read(data, { type: 'array', cellDates: true })
  const format = isV2Workbook(workbook) ? 'v2' : 'v1'
  const requiredSheets = format === 'v2' ? REQUIRED_SHEETS_V2 : REQUIRED_SHEETS_V1
  const missing = requiredSheets.filter(sheet => !workbook.SheetNames.includes(sheet))
  const issues: LegacyMigrationIssue[] = missing.map(sheet => ({
    severity: 'error',
    code: 'MISSING_SHEET',
    message: `Required sheet is missing: ${sheet}`,
    sheet,
  }))

  const memberRows = getRows(workbook, 'member')
  const userRows = format === 'v2'
    ? memberRows.map(row => ({ ...row, STATUS: 'available', 'FRIENDS INVITE': row.REFERRAL }))
    : getRows(workbook, 'User')
  const checkInRows = canonicalizeCheckInRows(getRows(workbook, 'Check In'))
  const feeRows = format === 'v2'
    ? memberRows.map(row => ({
      ...row,
      'TIME REQUEST': row['ACTIVATION DATE'],
      'PRICE (RM)': row.MEMBERSHIP,
      STATUS: row['ACTIVATION DATE'] ? 'successful' : 'reject',
    }))
    : getRows(workbook, 'FEE MEMBER')
  const reloadRows = getRows(workbook, 'reload')
  const redemptionRows = getRows(workbook, 'Redemption')

  const importableUsers = userRows.filter(row => ['available', 'pending'].includes(lower(row.STATUS)))
  const deletedUsers = userRows.filter(row => lower(row.STATUS) === 'delete')
  const invalidIdentityRows = new Set<number>()
  importableUsers.forEach(row => {
    const email = normalizeLegacyEmail(row.EMAIL)
    const phone = normalizeLegacyPhone(phoneValue(row))
    if (email && phone) return
    invalidIdentityRows.add(row.__row)
    issues.push({
      severity: 'error',
      code: 'INVALID_USER_IDENTITY',
      message: `User requires a valid email and Malaysian phone number: ${text(row.NAME) || 'Unnamed user'}`,
      sheet: format === 'v2' ? 'member' : 'User',
      row: row.__row,
    })
  })

  const duplicateRows = new Set<number>()
  const userSheetName = format === 'v2' ? 'member' : 'User'
  addDuplicateIssues(userRows, issues, duplicateRows, 'PHONE NUMBER', normalizeLegacyPhone, userSheetName)
  addDuplicateIssues(userRows, issues, duplicateRows, 'EMAIL', normalizeLegacyEmail, userSheetName)

  const businessPhones = new Set<string>([
    ...identityPhones(memberRows),
    ...identityPhones(reloadRows),
    ...identityPhones(feeRows.filter(row => lower(row.STATUS) === 'successful')),
    ...identityPhones(checkInRows.filter(row => lower(row.STATUS) === 'successful')),
    ...identityPhones(redemptionRows.filter(row => lower(row.STATUS) === 'successful')),
  ])
  const archivedWithHistory = deletedUsers.filter(row => {
    const phone = normalizeLegacyPhone(phoneValue(row))
    return !!phone && businessPhones.has(phone)
  })
  archivedWithHistory.forEach(row => issues.push({
    severity: 'warning',
    code: 'DELETED_USER_HAS_HISTORY',
    message: `Deleted user has business history and needs an archived Firestore identity: ${text(row.NAME)}`,
    sheet: 'User',
    row: row.__row,
  }))

  const memberPhones = identityPhones(memberRows)
  const reloadPhones = identityPhones(reloadRows)
  const balanceReviewPhones = [...reloadPhones].filter(phone => !memberPhones.has(phone))
  balanceReviewPhones.forEach(phone => issues.push({
    severity: 'warning',
    code: 'BALANCE_REVIEW_REQUIRED',
    message: `${phone} has reload history but no member wallet snapshot`,
    sheet: 'reload',
  }))

  const successfulCheckIns = checkInRows.filter(row => lower(row.STATUS) === 'successful')
  const successfulVisitKeys = new Set<string>()
  let duplicateSuccessfulRows = 0
  let completedMinutes = 0
  let anomalousDurationRows = 0
  const cleanSessions: Array<{ phone: string; lounge: string; start: Date; end: Date }> = []
  successfulCheckIns.forEach(row => {
    const phone = normalizeLegacyPhone(phoneValue(row))
    const start = asDate(row['TIME START'])
    const end = asDate(row['TIME END'])
    if (!phone || !start || !end || end < start) return
    const key = `${phone}|${start.toISOString()}|${lower(row.LOUNGE)}`
    if (successfulVisitKeys.has(key)) {
      duplicateSuccessfulRows += 1
      issues.push({
        severity: 'warning',
        code: 'DUPLICATE_SUCCESSFUL_VISIT',
        message: `Duplicate successful visit for ${phone}`,
        sheet: 'Check In',
        row: row.__row,
      })
      return
    }
    successfulVisitKeys.add(key)
    const minutes = Math.floor((end.getTime() - start.getTime()) / 60000)
    completedMinutes += minutes
    if (minutes <= 12 * 60 && lower(row.LOUNGE) !== 'demo branch') {
      cleanSessions.push({ phone, lounge: text(row.LOUNGE), start, end })
    }
  })

  const coVisitPairs = new Map<string, Set<string>>()
  for (let left = 0; left < cleanSessions.length; left += 1) {
    for (let right = left + 1; right < cleanSessions.length; right += 1) {
      const first = cleanSessions[left]
      const second = cleanSessions[right]
      if (first.phone === second.phone || first.lounge !== second.lounge) continue
      const overlapMinutes = Math.floor(
        (Math.min(first.end.getTime(), second.end.getTime()) - Math.max(first.start.getTime(), second.start.getTime())) / 60000,
      )
      if (overlapMinutes < 15) continue
      const pair = [first.phone, second.phone].sort().join('|')
      const day = new Date(Math.max(first.start.getTime(), second.start.getTime())).toISOString().slice(0, 10)
      coVisitPairs.set(pair, new Set([...(coVisitPairs.get(pair) || []), day]))
    }
  }

  const validReferralUsers = importableUsers.filter(row => !invalidIdentityRows.has(row.__row) && !duplicateRows.has(row.__row))
  const placeholderCount = validReferralUsers.reduce((sum, row) => sum + Math.max(0, Math.floor(numberValue(row['FRIENDS INVITE']))), 0)
  const referrerCount = validReferralUsers.filter(row => numberValue(row['FRIENDS INVITE']) > 0).length

  const lounges = new Set<string>()
  ;[checkInRows, feeRows, reloadRows, redemptionRows].forEach(rows => rows.forEach(row => {
    const lounge = text(row.LOUNGE)
    if (lounge) lounges.add(lounge)
  }))

  const cigarSlots = new Set(['first', 'second', 'third'])

  if (format === 'v2') {
    const declaredReload = memberRows.reduce((sum, row) => sum + numberValue(row['TOTAL RELOAD (RM)']), 0)
    const detailedReload = reloadRows.reduce((sum, row) => sum + numberValue(row['RELOAD (RM)']), 0)
    if (Math.abs(declaredReload - detailedReload) > 0.009) {
      issues.push({
        severity: 'warning',
        code: 'RELOAD_TOTAL_MISMATCH',
        message: `Member reload total is RM ${declaredReload}; reload detail total is RM ${detailedReload}`,
        sheet: 'member',
      })
    }

    const visitMinutesByPhone = new Map<string, number>()
    successfulCheckIns.forEach(row => {
      const phone = normalizeLegacyPhone(phoneValue(row))
      const start = asDate(row['TIME START'])
      const end = asDate(row['TIME END'])
      if (!phone || !start || !end || end < start) return
      const minutes = Math.floor((end.getTime() - start.getTime()) / 60000)
      if (minutes < 0) return
      visitMinutesByPhone.set(phone, (visitMinutesByPhone.get(phone) || 0) + minutes)
    })
    memberRows.forEach(row => {
      const phone = normalizeLegacyPhone(phoneValue(row))
      if (!phone) return
      const declared = durationMinutes(row['TOTAL SPEND'])
      const detailed = visitMinutesByPhone.get(phone) || 0
      if (Math.abs(declared - detailed) <= 5) return
      issues.push({
        severity: 'warning',
        code: 'VISIT_TOTAL_MISMATCH',
        message: `${phone} has ${formatDuration(declared)} declared and ${formatDuration(detailed)} detailed`,
        sheet: 'member',
        row: row.__row,
      })
    })
  }

  return {
    fileName,
    format,
    sheets: { found: workbook.SheetNames, missing },
    users: {
      totalRows: userRows.length,
      available: statusCount(userRows, 'available'),
      pending: statusCount(userRows, 'pending'),
      deleted: statusCount(userRows, 'delete'),
      readyForAuth: importableUsers.filter(row => !invalidIdentityRows.has(row.__row) && !duplicateRows.has(row.__row)).length,
      invalidIdentity: invalidIdentityRows.size,
      duplicateIdentityRows: duplicateRows.size,
      archivedWithHistory: archivedWithHistory.length,
    },
    referrals: {
      placeholderCount,
      referrerCount,
      coVisitCandidatePairs: coVisitPairs.size,
      repeatedCoVisitPairs: [...coVisitPairs.values()].filter(days => days.size >= 2).length,
    },
    wallet: {
      snapshotUsers: memberPhones.size,
      reloadRows: reloadRows.length,
      reloadAmount: reloadRows.reduce((sum, row) => sum + numberValue(row['RELOAD (RM)']), 0),
      usersRequiringBalanceReview: balanceReviewPhones.length,
    },
    membership: {
      successfulRows: statusCount(feeRows, 'successful'),
      rejectedRows: statusCount(feeRows, 'reject'),
      successfulUsers: identityPhones(feeRows.filter(row => lower(row.STATUS) === 'successful')).size,
    },
    visits: {
      successfulRows: successfulCheckIns.length,
      rejectedRows: statusCount(checkInRows, 'reject'),
      multipleRequestRows: statusCount(checkInRows, 'multiple request'),
      completedMinutes,
      duplicateSuccessfulRows,
      anomalousDurationRows,
    },
    redemptions: {
      successfulRows: statusCount(redemptionRows, 'successful'),
      rejectedRows: statusCount(redemptionRows, 'reject'),
      multipleRequestRows: statusCount(redemptionRows, 'multiple request'),
      unresolvedCigarRows: redemptionRows.filter(row => lower(row.STATUS) === 'successful' && cigarSlots.has(lower(row.CIGAR))).length,
    },
    lounges: [...lounges].sort(),
    issues,
  }
}

export const prepareLegacyMigrationWorkbook = (
  data: ArrayBuffer | Uint8Array,
  fileName = 'workbook.xlsx',
): PreparedLegacyMigrationWorkbook => {
  const report = analyzeLegacyMigrationWorkbook(data, fileName)
  const workbook = XLSX.read(data, { type: 'array', cellDates: true })
  const format = isV2Workbook(workbook) ? 'v2' : 'v1'
  const memberRows = getRows(workbook, 'member')
  const userRows = format === 'v2'
    ? memberRows.map(row => ({ ...row, STATUS: 'available', 'FRIENDS INVITE': row.REFERRAL }))
    : getRows(workbook, 'User')
  const checkInRows = canonicalizeCheckInRows(getRows(workbook, 'Check In'))
  const feeRows = format === 'v2'
    ? memberRows.map(row => ({
      ...row,
      'TIME REQUEST': row['ACTIVATION DATE'],
      'PRICE (RM)': row.MEMBERSHIP,
      STATUS: row['ACTIVATION DATE'] ? 'successful' : 'reject',
    }))
    : getRows(workbook, 'FEE MEMBER')
  const reloadRows = getRows(workbook, 'reload')
  const redemptionRows = getRows(workbook, 'Redemption')

  const emailPhones = new Map<string, Set<string>>()
  const phoneEmails = new Map<string, Set<string>>()
  userRows.forEach(row => {
    const email = normalizeLegacyEmail(row.EMAIL)
    const phone = normalizeLegacyPhone(phoneValue(row))
    if (!email || !phone) return
    emailPhones.set(email, new Set([...(emailPhones.get(email) || []), phone]))
    phoneEmails.set(phone, new Set([...(phoneEmails.get(phone) || []), email]))
  })

  const memberByPhone = new Map<string, SheetRow>()
  memberRows.forEach(row => {
    const phone = normalizeLegacyPhone(phoneValue(row))
    if (phone) memberByPhone.set(phone, row)
  })
  const seenPairs = new Set<string>()
  const users: LegacyMigrationUserRow[] = []
  const visitMinutesByPhone = new Map<string, number>()
  checkInRows.forEach(row => {
    if (lower(row.STATUS) !== 'successful') return
    const phone = normalizeLegacyPhone(phoneValue(row))
    const start = asDate(row['TIME START'])
    const end = asDate(row['TIME END'])
    if (!phone || !start || !end || end < start) return
    const minutes = Math.floor((end.getTime() - start.getTime()) / 60000)
    if (minutes < 0) return
    visitMinutesByPhone.set(phone, (visitMinutesByPhone.get(phone) || 0) + minutes)
  })
  userRows.forEach(row => {
    const email = normalizeLegacyEmail(row.EMAIL)
    const phone = normalizeLegacyPhone(phoneValue(row))
    const sourceStatus = lower(row.STATUS)
    if (!email || !phone || !['available', 'pending', 'delete'].includes(sourceStatus)) return
    if ((emailPhones.get(email)?.size || 0) > 1 || (phoneEmails.get(phone)?.size || 0) > 1) return
    const pair = `${email}|${phone}`
    if (seenPairs.has(pair)) return
    seenPairs.add(pair)
    const member = memberByPhone.get(phone)
    const declaredVisitMinutes = member ? durationMinutes(member['TOTAL SPEND']) : 0
    const detailedVisitMinutes = visitMinutesByPhone.get(phone) || 0
    const resolvedVisitMinutes = Math.max(declaredVisitMinutes, detailedVisitMinutes)
    const activationDate = member ? asDate(member['ACTIVATION DATE']) : undefined
    const activeUntil = activationDate ? addOneYear(activationDate) : undefined
    const now = new Date()
    users.push({
      sourceRow: row.__row,
      name: text(row.NAME) || email.split('@')[0],
      email,
      phone,
      sourceStatus: sourceStatus as LegacyMigrationUserRow['sourceStatus'],
      referralCount: Math.max(0, Math.floor(numberValue(row['FRIENDS INVITE'] ?? row.REFERRAL))),
      ...(member ? {
        walletBalance: numberValue(member['BALANCE RELOAD']),
        totalReload: numberValue(member['TOTAL RELOAD (RM)']),
        legacyVisitMinutes: declaredVisitMinutes,
        resolvedVisitMinutes,
        visitCarryForwardMinutes: Math.max(0, declaredVisitMinutes - detailedVisitMinutes),
        sourceLounge: text(member.LOUNGE),
        ...(activationDate && activeUntil ? {
          membershipActiveFrom: activationDate.toISOString(),
          membershipActiveUntil: activeUntil.toISOString(),
          membershipIsActive: now >= activationDate && now < activeUntil,
        } : {}),
      } : {}),
    })
  })

  const businessBase = (row: SheetRow, dateField: string): LegacyMigrationBusinessRow | undefined => {
    const phone = normalizeLegacyPhone(phoneValue(row))
    const occurredAt = asDate(row[dateField])
    if (!phone || !occurredAt) return undefined
    return {
      sourceRow: row.__row,
      name: text(nameValue(row)),
      phone,
      lounge: text(loungeValue(row)),
      occurredAt: occurredAt.toISOString(),
    }
  }

  const reloads = reloadRows.flatMap(row => {
    const reloadDateField = row['DATE::TIME'] !== undefined ? 'DATE::TIME' : 'RELOAD TIME STAMP'
    const base = businessBase(row, reloadDateField)
    const amount = numberValue(row['RELOAD (RM)'])
    if (!base || amount <= 0) return []
    return [{ ...base, email: normalizeLegacyEmail(row.EMAIL), amount }]
  })
  const memberships = feeRows.flatMap(row => {
    const base = businessBase(row, 'TIME REQUEST')
    const sourceStatus = lower(row.STATUS)
    if (!base || !['successful', 'reject'].includes(sourceStatus)) return []
    return [{ ...base, amount: numberValue(row['PRICE (RM)']), sourceStatus: sourceStatus as 'successful' | 'reject' }]
  })

  const seenVisits = new Set<string>()
  const visits = checkInRows.flatMap(row => {
    if (lower(row.STATUS) !== 'successful') return []
    const base = businessBase(row, 'TIME START')
    const endedAt = asDate(row['TIME END'])
    if (!base || !endedAt) return []
    const minutes = Math.floor((endedAt.getTime() - new Date(base.occurredAt).getTime()) / 60000)
    const key = `${base.phone}|${base.occurredAt}|${lower(base.lounge)}`
    if (minutes < 0 || seenVisits.has(key) || lower(base.lounge) === 'demo branch') return []
    seenVisits.add(key)
    const legacyFeeRm = numberValue(row['FEE (RM)'])
    return [{
      ...base,
      endedAt: endedAt.toISOString(),
      durationMinutes: minutes,
      ...(legacyFeeRm > 0 ? { legacyFeeRm } : {}),
    }]
  })
  const redemptions = redemptionRows.flatMap(row => {
    if (lower(row.STATUS) !== 'successful') return []
    const base = businessBase(row, 'TIME REQUEST')
    if (!base) return []
    return [{ ...base, cigar: text(row.CIGAR) }]
  })

  return { report, payload: { users, reloads, memberships, visits, redemptions } }
}
