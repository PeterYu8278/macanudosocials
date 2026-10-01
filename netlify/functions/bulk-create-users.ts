import type { Handler } from '@netlify/functions'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp, getFirestore } from 'firebase-admin/firestore'

type ImportRow = {
  name?: unknown
  email?: unknown
  phone?: unknown
  activationDate?: unknown
  invitedCount?: unknown
  totalVisitHours?: unknown
  points?: unknown
  redeemedCigarCount?: unknown
}

const json = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
})

const simpleHash = (value: string) => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash)
}

const memberIdFor = (uid: string) => simpleHash(uid).toString(36).toUpperCase().padStart(6, '0').slice(-6)

const parseDate = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value.trim())
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const numberOr = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const normalizePhone = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const raw = value.trim().replace(/[^\d+]/g, '')
  if (raw.startsWith('+')) return /^\+\d{8,15}$/.test(raw) ? raw : undefined
  if (raw.startsWith('60')) return /^\d{10,15}$/.test(raw) ? `+${raw}` : undefined
  if (raw.startsWith('0')) return `+60${raw.slice(1)}`
  return undefined
}

const addOneYear = (date: Date) => {
  const result = new Date(date)
  result.setFullYear(result.getFullYear() + 1)
  return result
}

const initAdmin = () => {
  if (getApps().length) return
  const credentials = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!credentials) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured')
  initializeApp({ credential: cert(JSON.parse(credentials)) })
}

export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  try {
    initAdmin()
    const token = (event.headers.authorization || event.headers.Authorization || '').match(/^Bearer (.+)$/)?.[1]
    if (!token) return json(401, { error: 'Authentication required' })
    const adminAuth = getAuth()
    const identity = await adminAuth.verifyIdToken(token, true)
    const db = getFirestore()
    const operator = (await db.collection('users').doc(identity.uid).get()).data()
    if (operator?.role !== 'developer') return json(403, { error: 'Developer access required' })

    const password = process.env.BULK_IMPORT_DEFAULT_PASSWORD
    if (!password || password.length < 6) return json(500, { error: 'BULK_IMPORT_DEFAULT_PASSWORD is not configured' })

    const body = JSON.parse(event.body || '{}') as { rows?: ImportRow[] }
    const rows = Array.isArray(body.rows) ? body.rows : []
    if (!rows.length || rows.length > 100) return json(400, { error: 'Import between 1 and 100 rows' })

    const created: Array<{ email: string; uid: string; memberId: string }> = []
    const failed: Array<{ row: number; email?: string; error: string }> = []

    for (const [index, row] of rows.entries()) {
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : ''
      const phone = normalizePhone(row.phone)
      if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        failed.push({ row: index + 1, email, error: 'Name and valid email are required' })
        continue
      }
      if (row.phone && !phone) {
        failed.push({ row: index + 1, email, error: 'Invalid phone number' })
        continue
      }

      let firebaseUser: Awaited<ReturnType<typeof adminAuth.createUser>> | null = null
      try {
        firebaseUser = await adminAuth.createUser({
          email,
          password,
          displayName: name,
          ...(phone ? { phoneNumber: phone } : {}),
        })
        const activationDate = parseDate(row.activationDate) || new Date()
        const now = Timestamp.now()
        const memberId = memberIdFor(firebaseUser.uid)
        const userRef = db.collection('users').doc(firebaseUser.uid)
        await userRef.set({
          displayName: name,
          email,
          memberId,
          role: 'member',
          status: 'active',
          profile: { phone: phone || null },
          membership: {
            level: 'bronze',
            joinDate: Timestamp.fromDate(activationDate),
            activeFrom: Timestamp.fromDate(activationDate),
            activeUntil: Timestamp.fromDate(addOneYear(activationDate)),
            points: numberOr(row.points),
            totalVisitHours: numberOr(row.totalVisitHours),
          },
          referral: { referrals: [], totalReferred: 0, activeReferrals: 0 },
          migration: {
            source: 'bulk_paste_import',
            importedAt: now,
            legacyFriendsInviteCount: numberOr(row.invitedCount),
            legacyRedeemedCigarCount: numberOr(row.redeemedCigarCount),
          },
          preferences: { locale: 'zh-CN', notifications: true },
          createdAt: now,
          updatedAt: now,
        })

        const invitedCount = Math.max(0, Math.floor(numberOr(row.invitedCount)))
        const redeemedCigarCount = Math.max(0, Math.floor(numberOr(row.redeemedCigarCount)))
        const placeholderWrites = []
        for (let placeholderIndex = 0; placeholderIndex < invitedCount; placeholderIndex += 1) {
          placeholderWrites.push(userRef.collection('migrationReferralPlaceholders').doc().set({
            referredUserId: null, referredUserName: null, referredUserMemberId: null,
            source: 'bulk_paste_import', status: 'placeholder', createdAt: now, updatedAt: now,
          }))
        }
        if (redeemedCigarCount > 0) {
          placeholderWrites.push(userRef.collection('migrationRedemptionPlaceholders').doc().set({
            cigarId: null, cigarName: null, quantity: redeemedCigarCount,
            source: 'bulk_paste_import', status: 'placeholder',
            redeemedAt: Timestamp.fromDate(activationDate), createdAt: now, updatedAt: now,
          }))
        }
        await Promise.all(placeholderWrites)
        created.push({ email, uid: firebaseUser.uid, memberId })
      } catch (error: any) {
        if (firebaseUser) {
          try { await adminAuth.deleteUser(firebaseUser.uid) } catch { /* keep row atomic */ }
        }
        failed.push({
          row: index + 1,
          email,
          error: error?.code === 'auth/email-already-exists' ? 'Email already exists' : error?.code === 'auth/phone-number-already-exists' ? 'Phone already exists' : 'Creation failed',
        })
      }
    }

    return json(200, { success: true, created, failed, createdCount: created.length, failedCount: failed.length })
  } catch (error: any) {
    return json(error?.code === 'auth/id-token-revoked' ? 401 : 500, { error: error?.message || 'Bulk import failed' })
  }
}
