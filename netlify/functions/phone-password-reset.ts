import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { createHash, randomUUID } from 'node:crypto'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { initializeFirestore } from './_shared/firestoreMonitoring'
import { normalizePhoneNumber } from '../../src/utils/phoneNormalization'
import { assertWhatsAppBinding, loadWhatsApp, submitWhapi } from './_shared/whatsapp'
import { assertMeowBinding, loadMeow, submitMeow } from './_shared/whatsmeow'

const reply = (statusCode: number, code?: string) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ success: statusCode === 200, ...(code && { code }) }),
})

export const eventHandler: Handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, 'method-not-allowed')
  if (!event.body || event.body.length > 2048) return reply(400, 'invalid-request')
  let phone: string | null
  try {
    const input = JSON.parse(event.body)
    phone = typeof input?.phone === 'string' ? normalizePhoneNumber(input.phone) : null
  } catch { return reply(400, 'invalid-request') }
  if (!phone) return reply(400, 'invalid-phone')

  let stage = 'initialize'
  try {
    if (!getApps().length) {
      const credentials = process.env.FIREBASE_SERVICE_ACCOUNT
      if (!credentials) throw new Error('missing-config')
      initializeApp({ credential: cert(JSON.parse(credentials)) })
    }
    const db = initializeFirestore(getApps()[0], { preferRest: true })
    stage = 'load_channel'
    const loaded = await loadWhatsApp(db)
    const { config, token, verified } = loaded
    const meow = config.defaultProvider === 'whatsmeow' ? await loadMeow(db) : null
    const unavailable = !config.enabled ? 'channel_disabled'
      : !config.features.passwordReset ? 'recovery_disabled'
        : !meow && config.defaultProvider !== 'whapi' ? 'provider_unavailable'
          : !meow && !token ? 'credentials_missing' : !meow && !verified ? 'verification_required' : null
    if (unavailable) {
      console.error('[phone-password-reset] Unavailable', { stage, reason: unavailable })
      return reply(503, 'service-unavailable')
    }
    stage = 'rate_limit'
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
      if (meow) await assertMeowBinding(db, transaction, meow)
      else if (loaded.binding) await assertWhatsAppBinding(db, transaction, loaded.binding, true)
      refs.forEach((ref, index) => transaction.set(ref, { ...attempts[index], count: attempts[index].count + 1, expiresAt: new Date(now + 300000) }))
      return true
    })
    if (!allowed) return reply(429, 'too-many-requests')
    stage = 'lookup'
    const users = await db.collection('users').where('profile.phone', '==', phone).limit(2).get()
    // Identical response for absent/ambiguous accounts. Never expose an email or reset link.
    if (users.docs.length !== 1) return reply(200)
    const email = users.docs[0].data().email
    if (typeof email !== 'string' || !email) return reply(200)
    let link: string
    stage = 'generate_link'
    try { link = await getAuth().generatePasswordResetLink(email) } catch (error: any) {
      if (error.code === 'auth/user-not-found') return reply(200)
      throw error
    }
    stage = 'submit_message'
    const text = `Macanudo Socials: Reset your password using this link:\n${link}\nIf you did not request this, ignore this message. Your password has not been changed.`
    const response = meow ? await submitMeow(meow, randomUUID(), phone, text, Date.now() + 60000) : await submitWhapi(token, phone, text)
    if (response.status !== 'accepted') {
      console.error('[phone-password-reset] Unavailable', { stage, reason: response.status === 'unknown' ? 'delivery_unknown' : 'delivery_failed' })
      return reply(503, 'service-unavailable')
    }
    return reply(200)
  } catch {
    // Do not log phone numbers, provider credentials or recovery links.
    console.error('[phone-password-reset] Failed', { stage, reason: 'dependency_error' })
    return reply(503, 'service-unavailable')
  }
}

export default toWebFunction(eventHandler)
