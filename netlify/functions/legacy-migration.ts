import type { Handler } from '@netlify/functions'
import { createHash } from 'node:crypto'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp, getFirestore } from 'firebase-admin/firestore'

type Stage = 'users' | 'reload' | 'membership' | 'visits'
type AnyRow = Record<string, any> & { sourceRow?: number; phone?: string }

const json = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
})

const initAdmin = () => {
  if (getApps().length) return
  const credentials = process.env.FIREBASE_SERVICE_ACCOUNT
  if (!credentials) throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured')
  initializeApp({ credential: cert(JSON.parse(credentials)) })
}

const stableId = (...parts: unknown[]) => createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)
const memberIdFor = (uid: string) => parseInt(stableId(uid).slice(0, 10), 16).toString(36).toUpperCase().padStart(6, '0').slice(-6)
const addOneYear = (date: Date) => {
  const result = new Date(date)
  result.setFullYear(result.getFullYear() + 1)
  return result
}
const validDate = (value: unknown) => {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? null : date
}

const getAuthUserByEmail = async (email: string) => {
  try { return await getAuth().getUserByEmail(email) } catch (error: any) {
    if (error?.code === 'auth/user-not-found') return null
    throw error
  }
}
const getAuthUserByPhone = async (phone: string) => {
  try { return await getAuth().getUserByPhoneNumber(phone) } catch (error: any) {
    if (error?.code === 'auth/user-not-found') return null
    throw error
  }
}

const loadPhoneUsers = async () => {
  const snapshot = await getFirestore().collection('users').get()
  const map = new Map<string, { id: string; data: FirebaseFirestore.DocumentData }>()
  snapshot.docs.forEach(document => {
    const data = document.data()
    const phone = data.profile?.phone
    if (typeof phone === 'string' && phone) map.set(phone, { id: document.id, data })
  })
  return map
}

const loadLounges = async () => {
  const snapshot = await getFirestore().collection('stores').get()
  return new Map(snapshot.docs.map(document => [String(document.data().name || '').trim().toLowerCase(), {
    id: document.id,
    name: String(document.data().name || document.id),
  }]))
}

const processUsers = async (rows: AnyRow[], batchId: string) => {
  const db = getFirestore()
  const auth = getAuth()
  const password = process.env.BULK_IMPORT_DEFAULT_PASSWORD
  if (!password || password.length < 6) throw new Error('BULK_IMPORT_DEFAULT_PASSWORD is not configured')
  const protectedRoles = new Set(['developer', 'superAdmin', 'admin', 'storeAdmin'])
  const result = { created: 0, updated: 0, skipped: 0, failed: [] as Array<{ row?: number; error: string }> }

  for (const row of rows) {
    try {
      const email = String(row.email || '').trim().toLowerCase()
      const phone = String(row.phone || '').trim()
      if (!email || !phone) throw new Error('Missing email or phone')
      const deleted = row.sourceStatus === 'delete'
      const [emailUser, phoneUser] = deleted
        ? [null, null]
        : await Promise.all([getAuthUserByEmail(email), getAuthUserByPhone(phone)])
      if (emailUser && phoneUser && emailUser.uid !== phoneUser.uid) throw new Error('Email and phone belong to different accounts')

      const emailMatch = await db.collection('users').where('email', '==', email).limit(2).get()
      const phoneMatch = await db.collection('users').where('profile.phone', '==', phone).limit(2).get()
      const existingDoc = emailMatch.docs[0] || phoneMatch.docs[0]
      if (emailMatch.docs[0] && phoneMatch.docs[0] && emailMatch.docs[0].id !== phoneMatch.docs[0].id) {
        throw new Error('Email and phone belong to different Firestore users')
      }
      const existing = existingDoc?.data()
      if (existing?.role && protectedRoles.has(existing.role)) {
        result.skipped += 1
        continue
      }

      let uid = (emailUser || phoneUser)?.uid || existingDoc?.id
      let created = false
      const membershipActiveFrom = validDate(row.membershipActiveFrom)
      const membershipActiveUntil = validDate(row.membershipActiveUntil)
      const membershipIsActive = row.membershipIsActive === true
      const accountEnabled = row.sourceStatus === 'available'
        && (row.membershipIsActive === undefined || membershipIsActive)
      if (deleted) {
        uid ||= `legacy_archived_${stableId(email, phone).slice(0, 20)}`
      } else if (emailUser || phoneUser) {
        await auth.updateUser(uid!, {
          email, phoneNumber: phone, displayName: row.name,
          disabled: !accountEnabled,
        })
      } else {
        const account = await auth.createUser({
          ...(uid ? { uid } : {}), email, phoneNumber: phone, displayName: row.name, password,
          disabled: !accountEnabled,
        })
        uid = account.uid
        created = true
      }

      const now = Timestamp.now()
      const userRef = db.collection('users').doc(uid!)
      const migratedRole = membershipActiveFrom
        ? (existing?.role === 'vip' ? 'vip' : 'member')
        : (existing?.role || 'guest')
      await userRef.set({
        displayName: row.name,
        email,
        memberId: existing?.memberId || memberIdFor(uid!),
        role: protectedRoles.has(existing?.role) ? existing.role : migratedRole,
        status: accountEnabled ? 'active' : 'inactive',
        profile: { ...(existing?.profile || {}), phone },
        membership: {
          ...(existing?.membership || {}),
          level: existing?.membership?.level || 'bronze',
          points: Number(row.walletBalance || 0),
          totalVisitHours: Number(row.resolvedVisitMinutes ?? row.legacyVisitMinutes ?? 0) / 60,
          ...(membershipActiveFrom && membershipActiveUntil ? {
            activeFrom: Timestamp.fromDate(membershipActiveFrom),
            activeUntil: Timestamp.fromDate(membershipActiveUntil),
            joinDate: existing?.membership?.joinDate || Timestamp.fromDate(membershipActiveFrom),
          } : {}),
        },
        migration: {
          ...(existing?.migration || {}),
          source: 'legacy_workbook', batchId, sourceRow: row.sourceRow,
          legacySourceStatus: row.sourceStatus,
          legacyReferralCount: Number(row.referralCount || 0),
          legacyTotalReload: Number(row.totalReload || 0),
          legacyVisitMinutes: Number(row.legacyVisitMinutes || 0),
          resolvedVisitMinutes: Number(row.resolvedVisitMinutes ?? row.legacyVisitMinutes ?? 0),
          visitCarryForwardMinutes: Number(row.visitCarryForwardMinutes || 0),
          sourceLounge: row.sourceLounge || null,
          archived: deleted,
          importedAt: now,
        },
        updatedAt: now,
        ...(!existing ? {
          referral: { referrals: [], totalReferred: 0, activeReferrals: 0 },
          preferences: { locale: 'zh-CN', notifications: true },
          createdAt: now,
        } : {}),
      }, { merge: true })
      for (let index = 0; index < Number(row.referralCount || 0); index += 1) {
        await userRef.collection('migrationReferralPlaceholders').doc(`legacy-${String(index + 1).padStart(4, '0')}`).set({
          referredUserId: null, referredUserName: null, source: 'legacy_workbook', batchId,
          status: 'placeholder', createdAt: now, updatedAt: now,
        }, { merge: true })
      }
      if (created) result.created += 1
      else result.updated += 1
    } catch (error: any) {
      result.failed.push({ row: row.sourceRow, error: error?.message || 'User import failed' })
    }
  }
  return result
}

const processReloads = async (rows: AnyRow[], batchId: string) => {
  const db = getFirestore()
  const users = await loadPhoneUsers()
  const lounges = await loadLounges()
  const result = { created: 0, updated: 0, skipped: 0, failed: [] as Array<{ row?: number; error: string }> }
  for (const row of rows) {
    try {
      const user = users.get(row.phone)
      if (!user) throw new Error('User not found for phone')
      const occurredAt = validDate(row.occurredAt)
      if (!occurredAt) throw new Error('Invalid reload date')
      const lounge = lounges.get(String(row.lounge || '').trim().toLowerCase())
      if (!lounge) throw new Error(`Lounge not mapped: ${row.lounge || '-'}`)
      const id = `legacy_${stableId(batchId, 'reload', row.sourceRow, row.phone, row.occurredAt)}`
      const ref = db.collection('reloadRecords').doc(id)
      const existed = (await ref.get()).exists
      const amount = Number(row.amount || 0)
      const at = Timestamp.fromDate(occurredAt)
      await ref.set({
        userId: user.id, userName: row.name || user.data.displayName,
        requestedAmount: amount, pointsEquivalent: Math.round(amount), status: 'completed',
        storeId: lounge.id, verifiedAt: at, verifiedBy: 'legacy_migration',
        adminNotes: 'Historical legacy import; wallet balance was restored from the member snapshot.',
        pointsRecordId: id, createdAt: at, updatedAt: Timestamp.now(),
        migration: { source: 'legacy_workbook', batchId, sourceRow: row.sourceRow },
      }, { merge: true })
      await db.collection('pointsRecords').doc(id).set({
        userId: user.id, userName: row.name || user.data.displayName, type: 'earn', amount: Math.round(amount),
        source: 'reload', description: 'Historical reload import', relatedId: id,
        createdAt: at, createdBy: 'legacy_migration',
        migration: { source: 'legacy_workbook', batchId, sourceRow: row.sourceRow, balanceNotApplied: true },
      }, { merge: true })
      if (existed) result.updated += 1
      else result.created += 1
    } catch (error: any) { result.failed.push({ row: row.sourceRow, error: error?.message || 'Reload import failed' }) }
  }
  return result
}

const processMemberships = async (rows: AnyRow[], batchId: string) => {
  const db = getFirestore()
  const users = await loadPhoneUsers()
  const lounges = await loadLounges()
  const result = { created: 0, updated: 0, skipped: 0, failed: [] as Array<{ row?: number; error: string }> }
  for (const row of rows) {
    try {
      const user = users.get(row.phone)
      if (!user) throw new Error('User not found for phone')
      const activatedAt = validDate(row.occurredAt)
      if (!activatedAt) throw new Error('Invalid activation date')
      const lounge = lounges.get(String(row.lounge || '').trim().toLowerCase())
      if (!lounge) throw new Error(`Lounge not mapped: ${row.lounge || '-'}`)
      const id = `legacy_${stableId(batchId, 'membership', row.sourceRow, row.phone, row.occurredAt)}`
      const ref = db.collection('membershipFeeRecords').doc(id)
      const existed = (await ref.get()).exists
      const activeUntil = addOneYear(activatedAt)
      const at = Timestamp.fromDate(activatedAt)
      await ref.set({
        userId: user.id, userName: row.name || user.data.displayName, amount: Number(row.amount || 0),
        dueDate: Timestamp.fromDate(activeUntil), deductedAt: row.sourceStatus === 'successful' ? at : null,
        storeId: lounge.id, status: row.sourceStatus === 'successful' ? 'paid' : 'cancelled',
        renewalType: 'initial', createdAt: at, updatedAt: Timestamp.now(),
        migration: { source: 'legacy_workbook', batchId, sourceRow: row.sourceRow },
      }, { merge: true })
      if (row.sourceStatus === 'successful') {
        const currentFrom = user.data.membership?.activeFrom?.toDate?.() as Date | undefined
        if (!currentFrom || activatedAt >= currentFrom) {
          const now = new Date()
          const active = now >= activatedAt && now < activeUntil && user.data.migration?.legacySourceStatus === 'available'
          await db.collection('users').doc(user.id).set({
            role: protectedRole(user.data.role) ? user.data.role : 'member',
            status: active ? 'active' : 'inactive',
            membership: {
              ...(user.data.membership || {}),
              activeFrom: at,
              activeUntil: Timestamp.fromDate(activeUntil),
              joinDate: user.data.membership?.joinDate || at,
            },
            updatedAt: Timestamp.now(),
          }, { merge: true })
        }
      }
      if (existed) result.updated += 1
      else result.created += 1
    } catch (error: any) { result.failed.push({ row: row.sourceRow, error: error?.message || 'Membership import failed' }) }
  }
  return result
}

const protectedRole = (role: unknown) => ['developer', 'superAdmin', 'admin', 'storeAdmin'].includes(String(role))

const processVisits = async (rows: AnyRow[], redemptions: AnyRow[], batchId: string) => {
  const db = getFirestore()
  const users = await loadPhoneUsers()
  const lounges = await loadLounges()
  const result = { created: 0, updated: 0, skipped: 0, failed: [] as Array<{ row?: number; error: string }> }
  const sessionsByPhone = new Map<string, Array<{ id: string; start: Date; end: Date; lounge: string; userId: string; userName: string }>>()
  for (const row of rows) {
    try {
      const user = users.get(row.phone)
      if (!user) throw new Error('User not found for phone')
      const start = validDate(row.occurredAt)
      const end = validDate(row.endedAt)
      if (!start || !end || end < start) throw new Error('Invalid visit dates')
      const lounge = lounges.get(String(row.lounge || '').trim().toLowerCase())
      if (!lounge) throw new Error(`Lounge not mapped: ${row.lounge || '-'}`)
      const id = `legacy_${stableId(batchId, 'visit', row.sourceRow, row.phone, row.occurredAt)}`
      const ref = db.collection('visitSessions').doc(id)
      const existed = (await ref.get()).exists
      const minutes = Math.max(0, Math.floor(Number(row.durationMinutes || 0)))
      await ref.set({
        userId: user.id, userName: row.name || user.data.displayName, storeId: lounge.id, storeName: lounge.name,
        checkInAt: Timestamp.fromDate(start), checkInBy: 'legacy_migration',
        checkOutAt: Timestamp.fromDate(end), checkOutBy: 'legacy_migration',
        durationMinutes: minutes, durationHours: minutes / 60, calculatedAt: Timestamp.fromDate(end),
        ...(Number(row.legacyFeeRm || 0) > 0 ? { legacyFeeRm: Number(row.legacyFeeRm) } : {}),
        status: 'completed', checkInType: 'membership', createdAt: Timestamp.fromDate(start), updatedAt: Timestamp.now(),
        migration: { source: 'legacy_workbook', batchId, sourceRow: row.sourceRow, sideEffectsSkipped: true },
      }, { merge: true })
      sessionsByPhone.set(row.phone, [...(sessionsByPhone.get(row.phone) || []), {
        id, start, end, lounge: lounge.id, userId: user.id, userName: row.name || user.data.displayName,
      }])
      if (existed) result.updated += 1
      else result.created += 1
    } catch (error: any) { result.failed.push({ row: row.sourceRow, error: error?.message || 'Visit import failed' }) }
  }
  for (const row of redemptions) {
    try {
      const user = users.get(row.phone)
      if (!user) throw new Error('User not found for phone')
      const occurredAt = validDate(row.occurredAt)
      if (!occurredAt) throw new Error('Invalid redemption date')
      const lounge = lounges.get(String(row.lounge || '').trim().toLowerCase())
      if (!lounge) throw new Error(`Lounge not mapped: ${row.lounge || '-'}`)
      const sessions = sessionsByPhone.get(row.phone) || []
      const matching = sessions.find(session => session.lounge === lounge.id && occurredAt >= session.start && occurredAt <= session.end)
      const sessionId = matching?.id || `legacy_orphan_${stableId(batchId, 'redemption-session', row.sourceRow, row.phone)}`
      if (!matching) {
        await db.collection('visitSessions').doc(sessionId).set({
          userId: user.id, userName: row.name || user.data.displayName, storeId: lounge.id, storeName: lounge.name,
          checkInAt: Timestamp.fromDate(occurredAt), checkInBy: 'legacy_migration',
          checkOutAt: Timestamp.fromDate(occurredAt), checkOutBy: 'legacy_migration', durationMinutes: 0, durationHours: 0,
          status: 'completed', checkInType: 'membership', createdAt: Timestamp.fromDate(occurredAt), updatedAt: Timestamp.now(),
          migration: { source: 'legacy_workbook', batchId, orphanRedemptionSession: true, sideEffectsSkipped: true },
        }, { merge: true })
      }
      const itemId = `legacy_${stableId(batchId, 'redemption', row.sourceRow, row.phone, row.occurredAt)}`
      const item = {
        id: itemId, userId: user.id, userName: row.name || user.data.displayName,
        type: String(row.cigar || '').toLowerCase().includes('friend') ? 'referral_reward' : 'mystery_gift',
        cigarId: `legacy_slot_${String(row.cigar || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        cigarName: row.cigar || 'Legacy cigar model pending', quantity: 1, status: 'completed',
        dayKey: occurredAt.toISOString().slice(0, 10), redemptionIndex: 1,
        redeemedAt: Timestamp.fromDate(occurredAt), redeemedBy: 'legacy_migration', createdAt: Timestamp.fromDate(occurredAt),
      }
      const ref = db.collection('redemptionRecords').doc(sessionId)
      const snapshot = await ref.get()
      const existing = snapshot.data()?.redemptions || []
      const withoutSame = existing.filter((entry: AnyRow) => entry.id !== itemId)
      await ref.set({
        visitSessionId: sessionId, userId: user.id, userName: row.name || user.data.displayName,
        redemptions: [...withoutSame, item], createdAt: snapshot.data()?.createdAt || Timestamp.fromDate(occurredAt), updatedAt: Timestamp.now(),
        migration: { source: 'legacy_workbook', batchId },
      }, { merge: true })
      if (snapshot.exists) result.updated += 1
      else result.created += 1
    } catch (error: any) { result.failed.push({ row: row.sourceRow, error: error?.message || 'Redemption import failed' }) }
  }
  return result
}

export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })
  try {
    initAdmin()
    const token = (event.headers.authorization || event.headers.Authorization || '').match(/^Bearer (.+)$/)?.[1]
    if (!token) return json(401, { error: 'Authentication required' })
    const identity = await getAuth().verifyIdToken(token, true)
    const db = getFirestore()
    const operator = (await db.collection('users').doc(identity.uid).get()).data()
    if (operator?.role !== 'developer') return json(403, { error: 'Developer access required' })

    const body = JSON.parse(event.body || '{}') as { stage?: Stage; batchId?: string; rows?: AnyRow[]; redemptions?: AnyRow[] }
    if (!body.stage || !['users', 'reload', 'membership', 'visits'].includes(body.stage)) return json(400, { error: 'Invalid migration stage' })
    if (!body.batchId || !/^legacy_[a-f0-9]{24}$/.test(body.batchId)) return json(400, { error: 'Invalid migration batch' })
    const rows = Array.isArray(body.rows) ? body.rows : []
    const batchRef = db.collection('migrationBatches').doc(body.batchId)
    await batchRef.set({ source: 'legacy_workbook', updatedAt: Timestamp.now(), updatedBy: identity.uid }, { merge: true })
    let result
    if (body.stage === 'users') result = await processUsers(rows, body.batchId)
    else if (body.stage === 'reload') result = await processReloads(rows, body.batchId)
    else if (body.stage === 'membership') result = await processMemberships(rows, body.batchId)
    else result = await processVisits(rows, Array.isArray(body.redemptions) ? body.redemptions : [], body.batchId)
    await batchRef.set({
      stages: { [body.stage]: { ...result, failed: result.failed.slice(0, 100), completedAt: Timestamp.now() } },
      updatedAt: Timestamp.now(),
    }, { merge: true })
    return json(200, { success: true, stage: body.stage, ...result, failedCount: result.failed.length })
  } catch (error: any) {
    return json(error?.code === 'auth/id-token-revoked' ? 401 : 500, { error: error?.message || 'Legacy migration failed' })
  }
}
