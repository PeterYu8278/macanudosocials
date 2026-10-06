import type { Handler } from '@netlify/functions'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS } from '../../src/config/globalCollections'
import { authorizeMemberChange, MemberIdentityError, resolveMemberAccount } from './_shared/memberIdentity'
import { lockMemberIdentity } from './_shared/memberIdentityLock'

const reply = (statusCode: number, code: string) => ({ statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ success: statusCode === 200, code }) })

export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, 'method-not-allowed')
  const token = (event.headers.authorization || event.headers.Authorization || '').match(/^Bearer (.+)$/)?.[1]
  if (!token) return reply(401, 'auth-required')
  let userId: unknown
  try {
    if (!event.body || event.body.length > 1024) return reply(400, 'invalid-request')
    userId = JSON.parse(event.body)?.userId
  } catch { return reply(400, 'invalid-request') }
  if (typeof userId !== 'string' || !userId || userId.length > 128 || userId.includes('/')) return reply(400, 'invalid-request')
  let unlock: (() => Promise<void>) | undefined
  try {
    if (!getApps().length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) return reply(503, 'service-unavailable')
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      initializeApp({ projectId: serviceAccount.project_id, credential: cert(serviceAccount) })
    }
    const accountAuth = getAuth()
    let identity
    try { identity = await accountAuth.verifyIdToken(token, true) } catch { return reply(401, 'auth-required') }
    const db = getFirestore()
    const users = db.collection(GLOBAL_COLLECTIONS.USERS)
    const operator = (await users.doc(identity.uid).get()).data()
    if (!['superAdmin', 'developer'].includes(operator?.role)) return reply(403, 'forbidden')
    if (identity.uid === userId) return reply(403, 'forbidden')
    const ref = users.doc(userId)
    const member = (await ref.get()).data()
    if (!member) return reply(200, 'deleted')
    let accountUid = member.authUid || userId
    try { accountUid = (await resolveMemberAccount(accountAuth, userId, member)).uid } catch (error) {
      if (!(error instanceof MemberIdentityError) || error.code !== 'auth-account-missing') throw error
    }
    if (accountUid === identity.uid) return reply(403, 'forbidden')
    await authorizeMemberChange(db, identity.uid, userId, member, accountUid, true)
    unlock = await lockMemberIdentity(db, [`uid:${accountUid}`, `email:${member.email || ''}`, `phone:${member.profile?.phone || ''}`])
    const latest = (await ref.get()).data()
    if (!latest) return reply(200, 'deleted')
    if (latest.authUid !== member.authUid || latest.email !== member.email) return reply(409, 'identity-conflict')
    await authorizeMemberChange(db, identity.uid, userId, latest, accountUid, true)
    // Ambiguous legacy mappings must be repaired before removing a login account.
    const mapped = await users.where('authUid', '==', accountUid).limit(2).get()
    if (mapped.docs.some(document => document.id !== userId)) return reply(409, 'identity-conflict')
    if (accountUid !== userId && (await users.doc(accountUid).get()).exists) return reply(409, 'identity-conflict')
    if (!member.authUid && member.email) {
      const byEmail = await users.where('email', '==', member.email.trim().toLowerCase()).limit(2).get()
      if (byEmail.docs.some(document => document.id !== userId)) return reply(409, 'identity-conflict')
    }
    if (!member.authUid) await ref.update({ authUid: accountUid })
    // Keep the profile on Auth failure. A retry can finish after Auth was already removed.
    try { await accountAuth.deleteUser(accountUid) } catch (error) {
      if ((error as { code?: string }).code !== 'auth/user-not-found') throw error
    }
    const batch = db.batch()
    batch.delete(ref)
    batch.create(db.collection(GLOBAL_COLLECTIONS.AUDIT_LOGS).doc(), {
      action: 'delete-member', userId, authUid: accountUid, operatorId: identity.uid, createdAt: Timestamp.now(),
    })
    await batch.commit()
    return reply(200, 'deleted')
  } catch (error) {
    if (error instanceof MemberIdentityError) return reply(error.status, error.code)
    return reply(503, 'service-unavailable')
  } finally {
    if (unlock) await unlock().catch(() => {})
  }
}
