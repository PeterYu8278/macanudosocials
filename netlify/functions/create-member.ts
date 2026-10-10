import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from './_shared/firestoreMonitoring'
import { randomBytes, randomInt } from 'node:crypto'
import { GLOBAL_COLLECTIONS } from '../../src/config/globalCollections'
import { normalizePhoneNumber } from '../../src/utils/phoneNormalization'
import { MemberIdentityError, resolveMemberAccount, authorizeMemberChange } from './_shared/memberIdentity'
import { assertUniqueMemberIdentity, lockMemberIdentity } from './_shared/memberIdentityLock'
import { sendMemberPasswordSetup } from './_shared/memberPasswordSetup'

const ranks: Record<string, number> = { guest: 0, member: 1, vip: 2, storeAdmin: 3, admin: 4, superAdmin: 5, developer: 6 }
const reply = (statusCode: number, code: string, extra = {}) => ({
  statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ success: statusCode === 200, code, ...extra }),
})

export const eventHandler: Handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, 'method-not-allowed')
  const token = (event.headers.authorization || event.headers.Authorization || '').match(/^Bearer (.+)$/)?.[1]
  if (!token) return reply(401, 'auth-required')
  if (!event.body || event.body.length > 8192) return reply(400, 'invalid-request')
  let input: any
  try { input = JSON.parse(event.body) } catch { return reply(400, 'invalid-request') }
  const ensureExisting = typeof input?.userId === 'string' && input.userId.length > 0 && !input.userId.includes('/')
  const email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : ''
  const name = typeof input?.displayName === 'string' ? input.displayName.trim() : ''
  const phone = typeof input?.phone === 'string' ? normalizePhoneNumber(input.phone) : null
  if (!ensureExisting && (!name || name.length > 128 || !phone || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !Object.hasOwn(ranks, input.role) || !['bronze', 'silver', 'gold', 'platinum'].includes(input.level))) {
    return reply(400, 'invalid-request')
  }
  let uid: string | undefined
  let unlock: (() => Promise<void>) | undefined
  try {
    if (!getApps().length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) return reply(503, 'service-unavailable')
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) })
    }
    const accountAuth = getAuth()
    let identity
    try { identity = await accountAuth.verifyIdToken(token, true) } catch { return reply(401, 'auth-required') }
    const db = getFirestore()
    const users = db.collection(GLOBAL_COLLECTIONS.USERS)
    const operator = (await users.doc(identity.uid).get()).data()
    if (ensureExisting) {
      const ref = users.doc(input.userId)
      const member = (await ref.get()).data()
      if (!member) return reply(404, 'member-not-found')
      await authorizeMemberChange(db, identity.uid, input.userId, member, member.authUid || input.userId, true)
      try {
        let existing = await resolveMemberAccount(accountAuth, input.userId, member)
        if (!member.authUid && existing.uid !== input.userId) {
          return reply(409, 'identity-conflict')
        }
        const canonicalEmail = existing.email?.trim().toLowerCase()
        const canonicalPhone = existing.phoneNumber || normalizePhoneNumber(member.profile?.phone || member.phone || '') || phone
        if (!canonicalEmail || !canonicalPhone) return reply(409, 'identity-required')
        unlock = await lockMemberIdentity(db, [`uid:${existing.uid}`, `email:${canonicalEmail}`, `phone:${canonicalPhone}`])
        existing = await accountAuth.getUser(existing.uid)
        const latestMember = (await ref.get()).data()
        if (!latestMember) return reply(404, 'member-not-found')
        await authorizeMemberChange(db, identity.uid, input.userId, latestMember, existing.uid, true)
        if (existing.email?.trim().toLowerCase() !== canonicalEmail || (existing.phoneNumber && existing.phoneNumber !== canonicalPhone)) return reply(409, 'change-busy')
        await assertUniqueMemberIdentity(db, canonicalEmail, canonicalPhone, input.userId)
        if (!existing.phoneNumber) await accountAuth.updateUser(existing.uid, { phoneNumber: canonicalPhone })
        const now = Timestamp.now()
        await ref.update({ authUid: existing.uid, email: canonicalEmail, 'profile.phone': canonicalPhone,
          ...(Object.hasOwn(latestMember, 'phone') ? { phone: canonicalPhone } : {}),
          emailAuth: { uid: existing.uid, verified: existing.emailVerified === true, syncedAt: now },
          'profile.phoneAuth': { uid: existing.uid, ownershipVerified: latestMember.profile?.phoneAuth?.ownershipVerified === true && latestMember.profile?.phone === canonicalPhone,
            updatedBy: identity.uid, updatedAt: now }, updatedAt: now })
        return reply(200, 'account-exists', { uid: existing.uid, email: canonicalEmail, phone: canonicalPhone })
      } catch (error) {
        if (!(error instanceof MemberIdentityError) || error.code !== 'auth-account-missing') throw error
      }
      const storedEmail = email || (typeof member.email === 'string' ? member.email.trim().toLowerCase() : '')
      const storedPhone = phone || normalizePhoneNumber(member.profile?.phone || member.phone || '')
      if (!storedEmail || storedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(storedEmail) || !storedPhone) return reply(400, 'identity-required')
      // A missing explicit mapping needs investigation rather than a second identity.
      if (member.authUid && member.authUid !== input.userId) return reply(409, 'identity-conflict')
      unlock = await lockMemberIdentity(db, [`uid:${input.userId}`, `email:${storedEmail}`, `phone:${storedPhone}`])
      for (const [field, value, code] of [['email', storedEmail, 'email-in-use'], ['profile.phone', storedPhone, 'phone-in-use'], ['phone', storedPhone, 'phone-in-use']] as const) {
        const matches = await users.where(field, '==', value).limit(2).get()
        if (matches.docs.some(document => document.id !== input.userId)) return reply(409, code)
      }
      const account = await accountAuth.createUser({ uid: input.userId, email: storedEmail, phoneNumber: storedPhone,
        password: randomBytes(32).toString('base64url'), displayName: member.displayName || storedEmail, emailVerified: false })
      uid = account.uid
      const now = Timestamp.now()
      await db.runTransaction(async transaction => {
        const latest = (await transaction.get(ref)).data()
        if (!latest || latest.email !== member.email || latest.profile?.phone !== member.profile?.phone || latest.role !== member.role) throw new Error('member-changed')
        transaction.update(ref, { authUid: account.uid, email: storedEmail, 'profile.phone': storedPhone, emailAuth: { verified: false },
          'profile.phoneAuth': { uid: account.uid, ownershipVerified: false, updatedBy: identity.uid, updatedAt: now }, updatedAt: now })
        transaction.create(db.collection(GLOBAL_COLLECTIONS.AUDIT_LOGS).doc(), {
          action: 'create-member-auth', userId: account.uid, operatorId: identity.uid, createdAt: now,
        })
      })
      const passwordSetupEmail = await sendMemberPasswordSetup(storedEmail)
      return reply(200, 'member-created', { uid: account.uid, email: storedEmail, phone: storedPhone, passwordSetupEmail })
    }
    if (!operator || !['admin', 'superAdmin', 'developer'].includes(operator.role)
      || ranks[input.role] >= ranks[operator.role]) return reply(403, 'forbidden')
    const discount = input.discount
    if (discount && (!['superAdmin', 'developer'].includes(operator.role)
      || (discount.rate != null && (typeof discount.rate !== 'number' || !Number.isFinite(discount.rate) || discount.rate < 0 || discount.rate > 100))
      || (discount.note != null && (typeof discount.note !== 'string' || discount.note.length > 1000)))) {
      return reply(400, 'invalid-request')
    }
    unlock = await lockMemberIdentity(db, [`email:${email}`, `phone:${phone}`])
    // Auth enforces uniqueness across concurrent account creation; also reject legacy profiles.
    for (const [field, value, code] of [['email', email, 'email-in-use'], ['profile.phone', phone, 'phone-in-use'], ['phone', phone, 'phone-in-use']] as const) {
      if (!(await users.where(field, '==', value).limit(1).get()).empty) return reply(409, code)
    }
    const account = await accountAuth.createUser({ email, password: randomBytes(32).toString('base64url'), phoneNumber: phone, displayName: name, emailVerified: false })
    uid = account.uid
    const now = Timestamp.now()
    const memberId = await db.runTransaction(async transaction => {
      let candidate = ''
      for (let attempt = 0; attempt < 10; attempt++) {
        candidate = randomInt(36 ** 6).toString(36).toUpperCase().padStart(6, '0')
        if ((await transaction.get(users.where('memberId', '==', candidate).limit(1))).empty) break
        candidate = ''
      }
      if (!candidate) throw new Error('member-id-unavailable')
      transaction.create(users.doc(account.uid), {
        authUid: account.uid, displayName: name, email, role: input.role, status: 'inactive', memberId: candidate,
        profile: { phone, gender: typeof input.gender === 'string' ? input.gender : null, race: typeof input.race === 'string' ? input.race : null,
          phoneAuth: { uid: account.uid, ownershipVerified: false, updatedBy: identity.uid, updatedAt: now } },
        emailAuth: { verified: false }, preferences: { locale: 'zh', notifications: true },
        membership: { level: input.level, joinDate: now, lastActive: now }, createdAt: now, updatedAt: now,
        ...(discount ? { discount: { ...(discount.rate != null ? { rate: discount.rate } : {}),
          ...(discount.note ? { note: discount.note } : {}), updatedBy: identity.uid, updatedAt: now } } : {}),
      })
      transaction.create(db.collection(GLOBAL_COLLECTIONS.AUDIT_LOGS).doc(), {
        action: 'create-member', userId: account.uid, operatorId: identity.uid, createdAt: now,
      })
      return candidate
    })
    const passwordSetupEmail = await sendMemberPasswordSetup(email)
    return reply(200, 'member-created', { uid: account.uid, memberId, passwordSetupEmail })
  } catch (error) {
    if (uid) {
      // A timed-out commit may have succeeded. Never delete Auth unless profile absence is confirmed.
      try {
        const profile = await getFirestore().collection(GLOBAL_COLLECTIONS.USERS).doc(uid).get()
        if (!profile.exists || (ensureExisting && profile.data()?.authUid !== uid)) await getAuth().deleteUser(uid)
      } catch { console.error('[create-member] rollback-unconfirmed', { uid }) }
    }
    const code = (error as { code?: string })?.code
    if (error instanceof MemberIdentityError) return reply(error.status, error.code)
    if (code === 'auth/email-already-exists') return reply(409, 'email-in-use')
    if (code === 'auth/phone-number-already-exists') return reply(409, 'phone-in-use')
    return reply(503, 'service-unavailable')
  } finally { try { await unlock?.() } catch { /* The lease expires after a crash. */ } }
}

export default toWebFunction(eventHandler)
