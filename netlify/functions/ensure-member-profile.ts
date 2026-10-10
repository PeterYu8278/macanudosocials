import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from './_shared/firestoreMonitoring'
import { randomInt } from 'node:crypto'
import { GLOBAL_COLLECTIONS } from '../../src/config/globalCollections'
import { MemberIdentityError } from './_shared/memberIdentity'
import { assertUniqueMemberIdentity, lockMemberIdentity } from './_shared/memberIdentityLock'
const reply = (statusCode: number, code: string, extra = {}) => ({ statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ success: statusCode === 200, code, ...extra }) })
export const eventHandler: Handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, 'method-not-allowed')
  const token = (event.headers.authorization || event.headers.Authorization || '').match(/^Bearer (.+)$/)?.[1]
  if (!token) return reply(401, 'auth-required')
  let unlock: (() => Promise<void>) | undefined
  try {
    if (!getApps().length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) return reply(503, 'service-unavailable')
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) })
    }
    let identity
    try { identity = await getAuth().verifyIdToken(token, true) } catch { return reply(401, 'auth-required') }
    const account = await getAuth().getUser(identity.uid)
    const email = account.email?.trim().toLowerCase()
    if (!email) return reply(409, 'identity-required')
    const db = getFirestore()
    const users = db.collection(GLOBAL_COLLECTIONS.USERS)
    unlock = await lockMemberIdentity(db, [`uid:${account.uid}`, `email:${email}`, ...(account.phoneNumber ? [`phone:${account.phoneNumber}`] : [])])
    const latest = await getAuth().getUser(account.uid)
    if (latest.email?.trim().toLowerCase() !== email || latest.phoneNumber !== account.phoneNumber) return reply(409, 'change-busy')
    const ref = users.doc(account.uid)
    if ((await ref.get()).exists) return reply(200, 'profile-exists', { userId: account.uid })
    const mapped = await users.where('authUid', '==', account.uid).limit(2).get()
    if (mapped.docs.length > 1) return reply(409, 'identity-conflict')
    if (mapped.docs.length === 1) return reply(200, 'profile-exists', { userId: mapped.docs[0].id })
    await assertUniqueMemberIdentity(db, email, account.phoneNumber, account.uid)
    const now = Timestamp.now()
    await db.runTransaction(async transaction => {
      // Protect concurrent bootstrap requests and never overwrite an established member.
      if ((await transaction.get(ref)).exists) return
      let memberId = ''
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = randomInt(36 ** 6).toString(36).toUpperCase().padStart(6, '0')
        if ((await transaction.get(users.where('memberId', '==', candidate).limit(1))).empty) { memberId = candidate; break }
      }
      if (!memberId) throw new Error('member-id-unavailable')
      transaction.create(ref, { authUid: account.uid, email, displayName: account.displayName || email.split('@')[0], memberId,
        role: 'guest', status: 'inactive', profile: { ...(account.phoneNumber ? { phone: account.phoneNumber,
          phoneAuth: { uid: account.uid, ownershipVerified: false, updatedBy: account.uid, updatedAt: now } } : {}) },
        emailAuth: { uid: account.uid, verified: account.emailVerified, syncedAt: now }, preferences: { locale: 'zh', notifications: true },
        membership: { level: 'bronze', joinDate: now, lastActive: now, points: 0, referralPoints: 0 },
        referral: { referredBy: null, referredByUserId: null, referralDate: null, referrals: [], totalReferred: 0, activeReferrals: 0 },
        createdAt: now, updatedAt: now })
    })
    return reply(200, 'profile-created', { userId: account.uid })
  } catch (error) {
    if (error instanceof MemberIdentityError) return reply(error.status, error.code)
    return reply(503, 'service-unavailable')
  } finally { try { await unlock?.() } catch { /* The lease expires after a crash. */ } }
}

export default toWebFunction(eventHandler)
