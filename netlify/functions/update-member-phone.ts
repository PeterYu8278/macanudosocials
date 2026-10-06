import type { Handler } from '@netlify/functions'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { normalizePhoneNumber } from '../../src/utils/phoneNormalization'
import { MemberIdentityError, resolveMemberAccount } from './_shared/memberIdentity'
import { assertUniqueMemberIdentity, lockMemberIdentity } from './_shared/memberIdentityLock'

const reply = (statusCode: number, code: string, extra = {}) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ success: statusCode === 200, code, ...extra }),
})
const ranks: Record<string, number> = { developer: 5, superAdmin: 4, admin: 3 }

export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, 'method-not-allowed')
  if (!event.body || event.body.length > 8192) return reply(400, 'invalid-request')
  let input: { userId?: unknown; phone?: unknown }
  try { input = JSON.parse(event.body || '{}') } catch { return reply(400, 'invalid-request') }
  if (!input || typeof input.userId !== 'string' || !input.userId || input.userId.includes('/')
    || typeof input.phone !== 'string') return reply(400, 'invalid-request')
  const phone = normalizePhoneNumber(input.phone)
  if (!phone) return reply(400, 'invalid-phone')
  const token = (event.headers.authorization || event.headers.Authorization || '').match(/^Bearer (.+)$/)?.[1]
  if (!token) return reply(401, 'auth-required')
  let authUpdated = false
  let unlock: (() => Promise<void>) | undefined
  try {
    if (!getApps().length) {
      const credentials = process.env.FIREBASE_SERVICE_ACCOUNT
      if (!credentials) throw new Error('missing-config')
      initializeApp({ credential: cert(JSON.parse(credentials)) })
    }
    const adminAuth = getAuth()
    const identity = await adminAuth.verifyIdToken(token, true)
    const age = Date.now() / 1000 - identity.auth_time
    if (!Number.isFinite(age) || age < -60 || age > 300
      || !['password', 'google.com'].includes(identity.firebase.sign_in_provider)) {
      return reply(401, 'reauth-required')
    }
    const db = getFirestore()
    const ref = db.collection('users').doc(input.userId)
    const member = (await ref.get()).data()
    if (!member) return reply(404, 'member-not-found')
    let account = await resolveMemberAccount(adminAuth, input.userId, member)
    if (account.uid !== identity.uid) {
      const operator = (await db.collection('users').doc(identity.uid).get()).data()
      const linkedMember = account.uid === input.userId ? member : (await db.collection('users').doc(account.uid).get()).data()
      const targetRank = Math.max(ranks[member.role] || (member.role === 'storeAdmin' ? 2 : 0), ranks[linkedMember?.role] || (linkedMember?.role === 'storeAdmin' ? 2 : 0))
      if (!operator || !ranks[operator.role] || targetRank >= ranks[operator.role]) {
        return reply(403, 'forbidden')
      }
    }
    unlock = await lockMemberIdentity(db, [`uid:${account.uid}`, `phone:${phone}`])
    account = await adminAuth.getUser(account.uid)
    await assertUniqueMemberIdentity(db, undefined, phone, input.userId)
    if (account.phoneNumber !== phone) await adminAuth.updateUser(account.uid, { phoneNumber: phone })
    authUpdated = true
    // Auth is authoritative. Repeating this request repairs a failed profile sync.
    await ref.update({
      authUid: account.uid,
      'profile.phone': phone,
      ...(Object.hasOwn(member, 'phone') ? { phone } : {}),
      'profile.phoneAuth': { uid: account.uid, ownershipVerified: false, updatedBy: identity.uid, updatedAt: Timestamp.now() },
      updatedAt: Timestamp.now(),
    })
    return reply(200, 'phone-updated', { phone })
  } catch (error) {
    if (error instanceof MemberIdentityError) return reply(error.status, error.code)
    const code = (error as { code?: string | number })?.code
    if (code === 'auth/phone-number-already-exists') return reply(409, 'phone-in-use')
    if (code === 'auth/invalid-phone-number') return reply(400, 'invalid-phone')
    if (typeof code === 'string' && ['auth/id-token-expired', 'auth/id-token-revoked', 'auth/argument-error', 'auth/user-disabled'].includes(code)) {
      return reply(401, 'reauth-required')
    }
    console.error('[update-member-phone] failed', { code: code || 'dependency-failure', authUpdated })
    return reply(503, authUpdated ? 'profile-sync-failed' : 'service-unavailable')
  } finally { try { await unlock?.() } catch { /* The short-lived lease releases after a crash. */ } }
}
