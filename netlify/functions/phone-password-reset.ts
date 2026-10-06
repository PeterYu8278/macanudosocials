import type { Handler } from '@netlify/functions'
import { createHash } from 'node:crypto'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { initializeFirestore } from 'firebase-admin/firestore'
import { normalizePhoneNumber } from '../../src/utils/phoneNormalization'
import { loadWhatsApp, submitWhapi } from './_shared/whatsapp'

const reply = (statusCode: number, code?: string) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ success: statusCode === 200, ...(code && { code }) }),
})

export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, 'method-not-allowed')
  if (!event.body || event.body.length > 2048) return reply(400, 'invalid-request')
  let phone: string | null
  try {
    const input = JSON.parse(event.body)
    phone = typeof input?.phone === 'string' ? normalizePhoneNumber(input.phone) : null
  } catch { return reply(400, 'invalid-request') }
  if (!phone) return reply(400, 'invalid-phone')

  try {
    if (!getApps().length) {
      const credentials = process.env.FIREBASE_SERVICE_ACCOUNT
      if (!credentials) throw new Error('missing-config')
      initializeApp({ credential: cert(JSON.parse(credentials)) })
    }
    const db = initializeFirestore(getApps()[0], { preferRest: true })
    const { config, token, verified } = await loadWhatsApp(db)
    if (!config.enabled || !config.features.passwordReset || config.defaultProvider !== 'whapi' || !token || !verified) return reply(503, 'service-unavailable')
    const keys = [`ip:${event.headers['x-nf-client-connection-ip'] || 'local'}`, `phone:${phone}`]
      .map(value => createHash('sha256').update(value).digest('hex'))
    const now = Date.now()
    const allowed = await db.runTransaction(async transaction => {
      const refs = keys.map(key => db.collection('_phonePasswordResetAttempts').doc(key))
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
    const users = await db.collection('users').where('profile.phone', '==', phone).limit(2).get()
    // Identical response for absent/ambiguous accounts. Never expose an email or reset link.
    if (users.docs.length !== 1) return reply(200)
    const email = users.docs[0].data().email
    if (typeof email !== 'string' || !email) return reply(200)
    let link: string
    try { link = await getAuth().generatePasswordResetLink(email) } catch (error: any) {
      if (error.code === 'auth/user-not-found') return reply(200)
      throw error
    }
    const response = await submitWhapi(token, phone, `Macanudo Socials: Reset your password using this link:\n${link}\nIf you did not request this, ignore this message. Your password has not been changed.`)
    if (response.status !== 'accepted') return reply(503, 'service-unavailable')
    return reply(200)
  } catch {
    // Do not log phone numbers, provider credentials or recovery links.
    return reply(503, 'service-unavailable')
  }
}
