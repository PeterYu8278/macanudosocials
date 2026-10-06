import type { Handler } from '@netlify/functions'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore'
import { createHash, randomInt } from 'node:crypto'
import { GLOBAL_COLLECTIONS } from '../../src/config/globalCollections'
import { normalizePhoneNumber } from '../../src/utils/phoneNormalization'
import { MemberIdentityError } from './_shared/memberIdentity'
import { assertUniqueMemberIdentity, lockMemberIdentity } from './_shared/memberIdentityLock'

const reply = (statusCode: number, code: string) => ({ statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ success: statusCode === 200, code }) })

export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, 'method-not-allowed')
  if (!event.body || event.body.length > 4096) return reply(400, 'invalid-request')
  let input: { email?: unknown; password?: unknown; displayName?: unknown; phone?: unknown; referralCode?: unknown }
  try { input = JSON.parse(event.body) } catch { return reply(400, 'invalid-request') }
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : ''
  const name = typeof input?.displayName === 'string' ? input.displayName.trim() : ''
  const phone = typeof input?.phone === 'string' ? normalizePhoneNumber(input.phone) : null
  const referral = typeof input?.referralCode === 'string' ? input.referralCode.trim().toUpperCase() : ''
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone || !name || name.length > 128
    || typeof input.password !== 'string' || input.password.length < 6 || input.password.length > 128
    || (referral && !/^[A-Z0-9]{6}$/.test(referral))) return reply(400, 'invalid-request')
  let unlock: (() => Promise<void>) | undefined
  let uid: string | undefined
  try {
    if (!getApps().length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) return reply(503, 'service-unavailable')
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) })
    }
    const db = getFirestore()
    const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown'
    const attempt = db.collection(GLOBAL_COLLECTIONS.REGISTRATION_ATTEMPTS).doc(createHash('sha256').update(ip).digest('hex'))
    await db.runTransaction(async transaction => {
      const data = (await transaction.get(attempt)).data()
      const count = data?.expiresAtMs > Date.now() ? Number(data.count) || 0 : 0
      if (count >= 10) throw new MemberIdentityError('too-many-requests', 429)
      transaction.set(attempt, { count: count + 1, expiresAtMs: data?.expiresAtMs > Date.now() ? data.expiresAtMs : Date.now() + 900000 })
    })
    unlock = await lockMemberIdentity(db, [`email:${email}`, `phone:${phone}`])
    await assertUniqueMemberIdentity(db, email, phone)
    const users = db.collection(GLOBAL_COLLECTIONS.USERS)
    const referrer = referral ? (await users.where('memberId', '==', referral).limit(1).get()).docs[0] : undefined
    if (referral && !referrer) return reply(400, 'invalid-referral-code')
    const account = await getAuth().createUser({ email, password: input.password, phoneNumber: phone, displayName: name, emailVerified: false })
    uid = account.uid
    const now = Timestamp.now()
    await db.runTransaction(async transaction => {
      let memberId = ''
      for (let attempt = 0; attempt < 10; attempt++) {
        const candidate = randomInt(36 ** 6).toString(36).toUpperCase().padStart(6, '0')
        if ((await transaction.get(users.where('memberId', '==', candidate).limit(1))).empty) { memberId = candidate; break }
      }
      if (!memberId) throw new Error('member-id-unavailable')
      if (referrer && !(await transaction.get(referrer.ref)).exists) throw new MemberIdentityError('invalid-referral-code', 400)
      transaction.create(users.doc(account.uid), {
        authUid: account.uid, email, displayName: name, memberId, role: 'guest', status: 'inactive',
        profile: { phone, phoneAuth: { uid: account.uid, ownershipVerified: false, updatedBy: account.uid, updatedAt: now } },
        emailAuth: { uid: account.uid, verified: false, syncedAt: now }, preferences: { locale: 'zh', notifications: true },
        membership: { level: 'bronze', joinDate: now, lastActive: now, points: 0, referralPoints: 0 },
        referral: { referredBy: referral || null, referredByUserId: referrer?.id || null, referralDate: referrer ? now : null,
          referrals: [], totalReferred: 0, activeReferrals: 0 }, createdAt: now, updatedAt: now,
      })
      if (referrer) transaction.update(referrer.ref, { 'referral.referrals': FieldValue.arrayUnion({ userId: account.uid, userName: name, memberId }),
        'referral.totalReferred': FieldValue.increment(1), updatedAt: now })
      transaction.create(db.collection(GLOBAL_COLLECTIONS.AUDIT_LOGS).doc(), { action: 'register-member', userId: account.uid, createdAt: now })
    })
    return reply(200, 'member-created')
  } catch (error) {
    if (uid) {
      try {
        // Keep a successfully committed account if Firestore's acknowledgement was lost.
        if (!(await getFirestore().collection(GLOBAL_COLLECTIONS.USERS).doc(uid).get()).exists) await getAuth().deleteUser(uid)
        else return reply(200, 'member-created')
      } catch { return reply(503, 'registration-recovery-required') }
    }
    if (error instanceof MemberIdentityError) return reply(error.status, error.code)
    const code = (error as { code?: string }).code
    if (code === 'auth/email-already-exists') return reply(409, 'email-in-use')
    if (code === 'auth/phone-number-already-exists') return reply(409, 'phone-in-use')
    return reply(503, 'service-unavailable')
  } finally { try { await unlock?.() } catch { /* The lease expires after a crash. */ } }
}
