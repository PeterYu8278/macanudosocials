import type { Handler } from '@netlify/functions'
import { createHash } from 'node:crypto'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { normalizePhoneNumber } from '../../src/utils/phoneNormalization'

const reply = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(statusCode === 429 && { 'Retry-After': '300' }) },
  body: JSON.stringify(body),
})
const invalidCredentials = () => reply(401, { success: false, code: 'auth/invalid-credential' })

export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, { success: false, code: 'method-not-allowed' })
  if (!event.body || event.body.length > 8192) return reply(400, { success: false, code: 'invalid-request' })
  let input: { phone?: unknown; password?: unknown }
  try { input = JSON.parse(event.body) } catch { return reply(400, { success: false, code: 'invalid-request' }) }
  if (!input || typeof input.phone !== 'string' || typeof input.password !== 'string' || !input.password || input.password.length > 4096) return invalidCredentials()
  const phone = normalizePhoneNumber(input.phone)
  if (!phone) return invalidCredentials()

  try {
    const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY
    if (!apiKey) throw new Error('missing-config')
    if (!getApps().length) {
      const credentials = process.env.FIREBASE_SERVICE_ACCOUNT
      if (!credentials) throw new Error('missing-config')
      initializeApp({ credential: cert(JSON.parse(credentials)) })
    }
    const db = getFirestore()
    const ip = event.headers['x-nf-client-connection-ip'] || 'local'
    const keys = [`ip:${ip}`, `phone:${phone}`].map(value => createHash('sha256').update(value).digest('hex'))
    const now = Date.now()
    const allowed = await db.runTransaction(async transaction => {
      const refs = keys.map(key => db.collection('_phoneLoginAttempts').doc(key))
      const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)))
      const attempts = snapshots.map(snapshot => {
        const data = snapshot.data()
        return data && now - Number(data.startedAt) < 300000 ? { startedAt: data.startedAt, count: Number(data.count) || 0 } : { startedAt: now, count: 0 }
      })
      if (attempts.some(attempt => attempt.count >= 20)) return false
      refs.forEach((ref, index) => transaction.set(ref, { ...attempts[index], count: attempts[index].count + 1, expiresAt: new Date(now + 300000) }))
      return true
    })
    if (!allowed) return reply(429, { success: false, code: 'auth/too-many-requests' })

    // This lookup is private: no email or profile is exposed before password verification.
    const users = await db.collection('users').where('profile.phone', '==', phone).limit(2).get()
    if (users.docs.length !== 1) return invalidCredentials()
    const email = users.docs[0].data().email
    if (typeof email !== 'string' || !email) return invalidCredentials()
    const verified = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: input.password, returnSecureToken: true }),
      signal: AbortSignal.timeout(10000),
    })
    const result = await verified.json() as { idToken?: string; localId?: string; error?: { message?: string } }
    if (!verified.ok) {
      if (result.error?.message?.startsWith('TOO_MANY_ATTEMPTS')) return reply(429, { success: false, code: 'auth/too-many-requests' })
      if (verified.status >= 500) throw new Error('upstream-unavailable')
      return invalidCredentials()
    }
    // MFA-pending responses have no ID token. Never mint a session before full authentication.
    if (!result.idToken || !result.localId) return invalidCredentials()
    const adminAuth = getAuth()
    const identity = await adminAuth.verifyIdToken(result.idToken, true)
    if (identity.uid !== result.localId || identity.email?.toLowerCase() !== email.toLowerCase()) return invalidCredentials()
    const customToken = await adminAuth.createCustomToken(identity.uid)
    return reply(200, { success: true, customToken })
  } catch {
    // Never log submitted passwords, phone numbers, or authentication tokens.
    return reply(503, { success: false, code: 'auth/service-unavailable' })
  }
}
