import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { createHash } from 'node:crypto'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS } from '../../src/config/globalCollections'

const reply = (statusCode: number, code?: string) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ success: statusCode === 200, ...(code ? { code } : {}) }),
})

export const eventHandler: Handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, 'method-not-allowed')
  if (!event.body || event.body.length > 2048) return reply(400, 'invalid-request')
  let email: string
  try {
    const input = JSON.parse(event.body)
    email = typeof input?.email === 'string' ? input.email.trim().toLowerCase() : ''
  } catch { return reply(400, 'invalid-request') }
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, 'invalid-email')
  try {
    if (!getApps().length) {
      const credentials = process.env.FIREBASE_SERVICE_ACCOUNT
      if (!credentials) return reply(503, 'service-unavailable')
      initializeApp({ credential: cert(JSON.parse(credentials)) })
    }
    const db = getFirestore()
    const config = (await db.collection(GLOBAL_COLLECTIONS.APP_CONFIG).doc('default').get()).data()
    if (config?.emailProviders?.passwordReset !== 'resend') return reply(409, 'provider-changed')
    const key = process.env.RESEND_API_KEY
    const from = process.env.MEMBER_EMAIL_FROM
    if (!key || !from) return reply(503, 'service-unavailable')
    const now = Date.now()
    const keys = [`ip:${event.headers['x-nf-client-connection-ip'] || 'local'}`, `email:${email}`]
      .map(value => createHash('sha256').update(value).digest('hex'))
    const allowed = await db.runTransaction(async transaction => {
      const refs = keys.map(id => db.collection('_emailPasswordResetAttempts').doc(id))
      const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)))
      const attempts = snapshots.map(snapshot => {
        const data = snapshot.data()
        return data && now - Number(data.startedAt) < 300000
          ? { startedAt: data.startedAt, count: Number(data.count) || 0 }
          : { startedAt: now, count: 0 }
      })
      if (attempts.some(attempt => attempt.count >= 5)) return false
      refs.forEach((ref, index) => transaction.set(ref, { ...attempts[index], count: attempts[index].count + 1, expiresAt: new Date(now + 300000) }))
      return true
    })
    if (!allowed) return reply(429, 'too-many-requests')
    let link: string
    try { link = await getAuth().generatePasswordResetLink(email) }
    catch (error: any) {
      // Do not reveal whether an account exists or return its recovery link.
      if (error.code === 'auth/user-not-found') return reply(200)
      throw error
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject: 'Reset your Macanudo Socials password',
        text: `Reset your password using this Firebase link:\n${link}\n\nIf you did not request this, ignore this email. Your password has not been changed.` }),
      signal: AbortSignal.timeout(10000),
    })
    return response.ok ? reply(200) : reply(503, 'service-unavailable')
  } catch {
    return reply(503, 'service-unavailable')
  }
}

export default toWebFunction(eventHandler)
