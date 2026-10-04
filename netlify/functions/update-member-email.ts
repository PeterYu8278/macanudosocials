import type { Handler } from '@netlify/functions'
import { randomUUID } from 'node:crypto'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { authorizeMemberChange, MemberIdentityError, resolveMemberAccount } from './_shared/memberIdentity'

const reply = (statusCode: number, code: string, extra = {}) => ({
  statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ success: statusCode === 200, code, ...extra }),
})
const normalize = (email: string) => email.trim().toLowerCase()
const modes = ['request', 'prepare', 'correct', 'sync', 'cancel']

export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, 'method-not-allowed')
  if (!event.body || event.body.length > 8192) return reply(400, 'invalid-request')
  let input: { userId?: unknown; email?: unknown; mode?: unknown }
  try { input = JSON.parse(event.body) } catch { return reply(400, 'invalid-request') }
  if (!input || typeof input.userId !== 'string' || !input.userId || input.userId.includes('/')
    || typeof input.mode !== 'string' || !modes.includes(input.mode)) return reply(400, 'invalid-request')
  const mode = input.mode
  const email = typeof input.email === 'string' ? normalize(input.email) : ''
  if (['request', 'prepare', 'correct'].includes(mode) && (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return reply(400, 'invalid-email')
  }
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
    if (mode !== 'sync') {
      const age = Date.now() / 1000 - identity.auth_time
      if (!Number.isFinite(age) || age < -60 || age > 300 || !['password', 'google.com'].includes(identity.firebase.sign_in_provider)) {
        return reply(401, 'reauth-required')
      }
    }
    const db = getFirestore()
    const ref = db.collection('users').doc(input.userId)
    let member = (await ref.get()).data()
    if (!member) return reply(404, 'member-not-found')
    let account = await resolveMemberAccount(adminAuth, input.userId, member)
    const self = identity.uid === account.uid
    if ((mode === 'prepare' || mode === 'sync') && !self) return reply(403, 'forbidden')
    await authorizeMemberChange(db, identity.uid, input.userId, member, account.uid, mode === 'correct')

    // Serialize backend requests for an Auth UID. A crashed function's lease expires.
    const lock = db.collection('_memberEmailLocks').doc(account.uid)
    const lockId = randomUUID()
    await db.runTransaction(async transaction => {
      const held = (await transaction.get(lock)).data()
      if (held && held.expiresAtMs > Date.now()) throw new MemberIdentityError('change-busy', 409)
      transaction.set(lock, { id: lockId, expiresAtMs: Date.now() + 60000 })
    })
    unlock = async () => {
      await db.runTransaction(async transaction => {
        if ((await transaction.get(lock)).data()?.id === lockId) transaction.delete(lock)
      })
    }
    member = (await ref.get()).data()
    if (!member) return reply(404, 'member-not-found')
    account = await adminAuth.getUser(account.uid)
    await authorizeMemberChange(db, identity.uid, input.userId, member, account.uid, mode === 'correct')

    const pending = member.emailChange
    if (mode === 'cancel') {
      if (pending?.email === normalize(account.email || '') && ['sync-pending', 'awaiting-verification'].includes(pending?.status)) return reply(409, 'sync-required')
      // Firebase-issued confirmation links cannot be revoked by clearing local state.
      if (pending?.status === 'awaiting-verification') return reply(409, 'verification-pending')
      const cancelled = pending ? { ...pending, status: 'cancelled', cancelledBy: identity.uid, cancelledAt: Timestamp.now() } : null
      const batch = db.batch()
      batch.update(ref, { emailChange: cancelled, updatedAt: Timestamp.now() })
      if (cancelled) batch.set(db.collection('_memberEmailChanges').doc(cancelled.id), cancelled, { merge: true })
      await batch.commit()
      return reply(200, 'request-cancelled')
    }
    const effectiveEmail = mode === 'sync' ? normalize(account.email || '') : email
    if (!effectiveEmail) return reply(409, 'auth-account-missing')
    if (mode === 'sync' && ['requested', 'awaiting-verification'].includes(pending?.status)
      && (effectiveEmail !== pending.email || !account.emailVerified)) return reply(409, 'verification-pending')
    if (mode === 'sync' && pending?.status === 'sync-pending' && effectiveEmail !== pending.email) return reply(409, 'sync-required')

    const duplicates = await db.collection('users').where('email', '==', effectiveEmail).limit(2).get()
    if (duplicates.docs.some(document => document.id !== input.userId)) return reply(409, 'email-in-use')
    if (mode !== 'sync') {
      try {
        const existing = await adminAuth.getUserByEmail(effectiveEmail)
        if (existing.uid !== account.uid) return reply(409, 'email-in-use')
      } catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') throw error }
    }

    if (mode === 'sync' && normalize(member.email || '') === effectiveEmail && member.authUid === account.uid
      && member.emailAuth?.verified === account.emailVerified && !['requested', 'awaiting-verification', 'sync-pending'].includes(pending?.status)) {
      return reply(200, 'email-synced', { email: effectiveEmail, verified: account.emailVerified })
    }
    const continuing = pending?.email === effectiveEmail && ['requested', 'awaiting-verification', 'sync-pending'].includes(pending.status)
      && (mode !== 'correct' || pending.method === 'admin-correction')
    if (pending?.status === 'sync-pending' && !continuing) return reply(409, 'sync-required')
    const change = continuing ? { ...pending } : {
      id: randomUUID(), email: effectiveEmail, previousEmail: mode === 'sync' ? member.email || '' : account.email || member.email || '',
      requestedBy: identity.uid, requestedAt: Timestamp.now(), method: mode === 'correct' ? 'admin-correction' : 'member-confirmation',
    }
    if (mode === 'request' || mode === 'prepare') {
      if (normalize(account.email || '') === effectiveEmail && normalize(member.email || '') === effectiveEmail) return reply(200, 'email-unchanged')
      if (mode === 'prepare' && continuing && pending.method === 'admin-correction') return reply(409, 'sync-required')
      change.status = mode === 'prepare' ? 'awaiting-verification' : 'requested'
    } else {
      change.status = 'sync-pending'
    }
    const audit = db.collection('_memberEmailChanges').doc(change.id)
    // Persist the UID before Auth changes, so retries never depend on the old email.
    const prepared = db.batch()
    prepared.update(ref, { authUid: account.uid, emailChange: change, updatedAt: Timestamp.now() })
    prepared.set(audit, { ...change, userId: input.userId, authUid: account.uid }, { merge: true })
    await prepared.commit()
    if (mode === 'request' || mode === 'prepare') return reply(200, 'verification-requested', { email: effectiveEmail })

    if (mode === 'correct' && normalize(account.email || '') !== effectiveEmail) {
      await adminAuth.updateUser(account.uid, { email: effectiveEmail, emailVerified: false })
    }
    authUpdated = true
    const latest = await adminAuth.getUser(account.uid)
    if (normalize(latest.email || '') !== effectiveEmail) return reply(409, 'sync-required')
    const completed = { ...change, status: 'completed', completedBy: identity.uid, completedAt: Timestamp.now() }
    const synced = db.batch()
    synced.update(ref, {
      email: effectiveEmail, authUid: latest.uid,
      emailAuth: { uid: latest.uid, verified: latest.emailVerified, syncedAt: Timestamp.now() },
      emailChange: completed, updatedAt: Timestamp.now(),
    })
    synced.set(audit, { ...completed, verified: latest.emailVerified }, { merge: true })
    await synced.commit()
    return reply(200, 'email-synced', { email: effectiveEmail, verified: latest.emailVerified })
  } catch (error) {
    if (error instanceof MemberIdentityError) return reply(error.status, error.code)
    const code = (error as { code?: string | number })?.code
    if (code === 'auth/email-already-exists') return reply(409, 'email-in-use')
    if (code === 'auth/invalid-email') return reply(400, 'invalid-email')
    if (typeof code === 'string' && ['auth/id-token-expired', 'auth/id-token-revoked', 'auth/argument-error', 'auth/user-disabled'].includes(code)) return reply(401, 'reauth-required')
    console.error('[update-member-email] failed', { code: code || 'dependency-failure', authUpdated })
    return reply(503, authUpdated ? 'profile-sync-failed' : 'service-unavailable')
  } finally {
    try { await unlock?.() } catch { /* The short-lived lease releases even if Firestore is unavailable. */ }
  }
}
