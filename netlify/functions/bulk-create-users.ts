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

const membershipStateFor = (activationDate: Date | null, now = new Date()) => {
  if (!activationDate) {
    return {
      role: 'guest' as const,
      status: 'inactive' as const,
      activeFrom: null,
      activeUntil: null,
    }
  }

  const activeUntil = addOneYear(activationDate)
  const isActive = now >= activationDate && now < activeUntil
  return {
    role: 'member' as const,
    status: isActive ? 'active' as const : 'inactive' as const,
    activeFrom: Timestamp.fromDate(activationDate),
    activeUntil: Timestamp.fromDate(activeUntil),
  }
}

const initAdmin = () => {
  if (getApps().length) return
  const credentials = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!credentials) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured')
  initializeApp({ credential: cert(JSON.parse(credentials)) })
}

const getUserByEmailOrNull = async (email: string) => {
  try {
    return await getAuth().getUserByEmail(email)
  } catch (error: any) {
    if (error?.code === 'auth/user-not-found') return null
    throw error
  }
}

const getUserByPhoneOrNull = async (phone: string) => {
  try {
    return await getAuth().getUserByPhoneNumber(phone)
  } catch (error: any) {
    if (error?.code === 'auth/user-not-found') return null
    throw error
  }
}

const PROTECTED_ROLES = new Set(['developer', 'superAdmin', 'admin', 'storeAdmin'])

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
    const updated: Array<{ email: string; uid: string; memberId: string }> = []
    const failed: Array<{ row: number; email?: string; error: string }> = []
    const seenEmails = new Set<string>()
    const seenPhones = new Set<string>()

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

      if (seenEmails.has(email) || (phone && seenPhones.has(phone))) {
        failed.push({ row: index + 1, email, error: 'Duplicate email or phone number in this import' })
        continue
      }
      seenEmails.add(email)
      if (phone) seenPhones.add(phone)

      let firebaseUser: Awaited<ReturnType<typeof adminAuth.createUser>> | null = null
      let createdAuthUser = false
      let existingUser: Record<string, any> | undefined
      try {
        const [emailUser, phoneUser, emailMatches, phoneMatches] = await Promise.all([
          getUserByEmailOrNull(email),
          phone ? getUserByPhoneOrNull(phone) : Promise.resolve(null),
          db.collection('users').where('email', '==', email).limit(2).get(),
          phone
            ? db.collection('users').where('profile.phone', '==', phone).limit(2).get()
            : Promise.resolve(null),
        ])
        if (emailUser && phoneUser && emailUser.uid !== phoneUser.uid) {
          throw new Error('IMPORT_IDENTITY_CONFLICT')
        }
        if (emailMatches.size > 1 || (phoneMatches && phoneMatches.size > 1)) {
          throw new Error('IMPORT_IDENTITY_CONFLICT')
        }

        const emailDoc = emailMatches.docs[0]
        const phoneDoc = phoneMatches?.docs[0]
        if (emailDoc && phoneDoc && emailDoc.id !== phoneDoc.id) {
          throw new Error('IMPORT_IDENTITY_CONFLICT')
        }
        const authUid = (emailUser || phoneUser)?.uid
        const firestoreUid = (emailDoc || phoneDoc)?.id
        if (authUid && firestoreUid && authUid !== firestoreUid) {
          throw new Error('IMPORT_IDENTITY_CONFLICT')
        }
        const matchedExistingIdentity = Boolean(authUid || firestoreUid)

        firebaseUser = emailUser || phoneUser
        if (firebaseUser) {
          existingUser = (await db.collection('users').doc(firebaseUser.uid).get()).data()
          if (existingUser?.role && PROTECTED_ROLES.has(existingUser.role)) {
            throw new Error('IMPORT_PROTECTED_ROLE')
          }
          firebaseUser = await adminAuth.updateUser(firebaseUser.uid, {
            email,
            displayName: name,
            ...(phone ? { phoneNumber: phone } : {}),
          })
        } else {
          existingUser = (emailDoc || phoneDoc)?.data()
          if (existingUser?.role && PROTECTED_ROLES.has(existingUser.role)) {
            throw new Error('IMPORT_PROTECTED_ROLE')
          }
          firebaseUser = await adminAuth.createUser({
            ...(firestoreUid ? { uid: firestoreUid } : {}),
            email,
            password,
            displayName: name,
            ...(phone ? { phoneNumber: phone } : {}),
          })
          createdAuthUser = true
        }

        const activationDate = parseDate(row.activationDate)
        const membershipState = membershipStateFor(activationDate)
        const now = Timestamp.now()
        const userRef = db.collection('users').doc(firebaseUser.uid)
        const memberId = existingUser?.memberId || memberIdFor(firebaseUser.uid)
        const userData: Record<string, unknown> = {
          displayName: name,
          email,
          memberId,
          role: membershipState.role,
          status: membershipState.status,
          profile: { phone: phone || null },
          membership: {
            level: 'bronze',
            joinDate: membershipState.activeFrom,
            activeFrom: membershipState.activeFrom,
            activeUntil: membershipState.activeUntil,
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
          updatedAt: now,
        }
        if (!existingUser) {
          userData.referral = { referrals: [], totalReferred: 0, activeReferrals: 0 }
          userData.preferences = { locale: 'zh-CN', notifications: true }
          userData.createdAt = now
        }
        await userRef.set(userData, { merge: true })

        const invitedCount = Math.max(0, Math.floor(numberOr(row.invitedCount)))
        const redeemedCigarCount = Math.max(0, Math.floor(numberOr(row.redeemedCigarCount)))
        const placeholderWrites = []
        for (let placeholderIndex = 0; placeholderIndex < invitedCount; placeholderIndex += 1) {
          const placeholderId = `legacy-referral-${String(placeholderIndex + 1).padStart(4, '0')}`
          placeholderWrites.push(userRef.collection('migrationReferralPlaceholders').doc(placeholderId).set({
            referredUserId: null, referredUserName: null, referredUserMemberId: null,
            source: 'bulk_paste_import', status: 'placeholder', createdAt: now, updatedAt: now,
          }, { merge: true }))
        }
        if (redeemedCigarCount > 0) {
          placeholderWrites.push(userRef.collection('migrationRedemptionPlaceholders').doc('legacy-total').set({
            cigarId: null, cigarName: null, quantity: redeemedCigarCount,
            source: 'bulk_paste_import', status: 'placeholder',
            redeemedAt: membershipState.activeFrom || now, createdAt: now, updatedAt: now,
          }, { merge: true }))
        }
        await Promise.all(placeholderWrites)
        const result = { email, uid: firebaseUser.uid, memberId }
        if (matchedExistingIdentity) updated.push(result)
        else created.push(result)
      } catch (error: any) {
        if (firebaseUser && createdAuthUser) {
          try { await adminAuth.deleteUser(firebaseUser.uid) } catch { /* keep row atomic */ }
        }
        failed.push({
          row: index + 1,
          email,
          error: error?.message === 'IMPORT_IDENTITY_CONFLICT'
            ? 'Email and phone belong to different accounts'
            : error?.message === 'IMPORT_PROTECTED_ROLE'
              ? 'Existing privileged account cannot be changed by member import'
              : error?.code === 'auth/email-already-exists'
                ? 'Email already exists on another account'
                : error?.code === 'auth/phone-number-already-exists'
                  ? 'Phone already exists on another account'
                  : 'Import failed',
        })
      }
    }

    return json(200, {
      success: true,
      created,
      updated,
      failed,
      createdCount: created.length,
      updatedCount: updated.length,
      failedCount: failed.length,
    })
  } catch (error: any) {
    return json(error?.code === 'auth/id-token-revoked' ? 401 : 500, { error: error?.message || 'Bulk import failed' })
  }
}
