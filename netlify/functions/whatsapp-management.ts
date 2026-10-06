import { toWebFunction, type EventHandler as Handler } from './_shared/webFunction'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, initializeFirestore, Timestamp } from 'firebase-admin/firestore'
import { createHash } from 'node:crypto'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
import { normalizePhoneNumber } from '../../src/utils/phoneNormalization'
import type { WhatsAppSettings } from '../../src/types/whatsapp'
import { loadWhatsApp, submitWhapi } from './_shared/whatsapp'

const reply = (statusCode: number, data = {}) => ({ statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ success: statusCode === 200, ...data }) })
const fail = (code: string, status = 400) => Object.assign(new Error(code), { code, status })
const managers = ['superAdmin', 'developer']
function validateConfig(value: any): WhatsAppSettings {
  if (!value || typeof value.enabled !== 'boolean' || !['manual', 'whapi', 'whatsmeow', 'waba'].includes(value.defaultProvider)) throw fail('invalid-request')
  const string = (input: unknown, max = 200) => {
    if (typeof input !== 'string' || input.length > max) throw fail('invalid-request')
    return input.trim()
  }
  const features = value.features
  if (!features || ['eventReminder', 'vipExpiry', 'passwordReset'].some(key => typeof features[key] !== 'boolean')) throw fail('invalid-request')
  if (!Array.isArray(value.testPhones) || value.testPhones.length > 20) throw fail('invalid-request')
  const testPhones = value.testPhones.map((phone: unknown) => typeof phone === 'string' ? normalizePhoneNumber(phone) : null)
  if (testPhones.some((phone: string | null) => !phone)) throw fail('invalid-phone')
  const baseUrl = string(value.whatsmeow?.baseUrl, 500)
  if (baseUrl) {
    let url
    try { url = new URL(baseUrl) } catch { throw fail('invalid-request') }
    if (url.protocol !== 'https:' || url.username || url.password) throw fail('invalid-request')
  }
  return { enabled: value.enabled, defaultProvider: value.defaultProvider,
    features: { eventReminder: features.eventReminder, vipExpiry: features.vipExpiry, passwordReset: features.passwordReset },
    whapi: { channelId: string(value.whapi?.channelId) },
    whatsmeow: { baseUrl, phone: string(value.whatsmeow?.phone) },
    waba: { wabaId: string(value.waba?.wabaId), phoneNumberId: string(value.waba?.phoneNumberId), phone: string(value.waba?.phone) },
    testPhones: [...new Set(testPhones)] as string[] }
}

export const eventHandler: Handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405)
  const token = (event.headers.authorization || event.headers.Authorization || '').match(/^Bearer (.+)$/)?.[1]
  if (!token) return reply(401)
  let input: any
  try {
    if (!event.body || event.body.length > 12000) return reply(400)
    input = JSON.parse(event.body)
  } catch { return reply(400) }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return reply(400)
  try {
    if (!getApps().length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) return reply(503)
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      initializeApp({ projectId: serviceAccount.project_id, credential: cert(serviceAccount) })
    }
    let identity
    try { identity = await getAuth().verifyIdToken(token, true) } catch { return reply(401) }
    const db = initializeFirestore(getApps()[0], { preferRest: true })
    const operator = (await db.collection(C.USERS).doc(identity.uid).get()).data()
    const manager = managers.includes(operator?.role)
    const admin = manager || operator?.role === 'admin'
    if (!admin && input.action !== 'send') return reply(403)
    const loaded = await loadWhatsApp(db)
    const { config } = loaded
    const ref = db.collection(C.WHATSAPP_CONFIG).doc('settings')
    const state = () => ({ config, whapiCredentials: !!loaded.token, whapiVerified: loaded.verified })
    if (input.action === 'load') return reply(200, state())
    if (input.action === 'save') {
      if (!manager) return reply(403)
      const next = validateConfig(input.config)
      const verified = loaded.verified && next.whapi.channelId === config.whapi.channelId
      if (['waba', 'whatsmeow'].includes(next.defaultProvider)) throw fail('channel-unavailable', 409)
      if (next.defaultProvider === 'whapi' && next.enabled && (!loaded.token || !verified)) throw fail('verification-required', 409)
      const batch = db.batch()
      batch.set(ref, { config: next, whapiVerified: verified, whapiTokenHash: verified ? loaded.tokenHash : '', updatedAt: Timestamp.now(), updatedBy: identity.uid })
      if (loaded.legacyToken) batch.set(db.collection(C.WHATSAPP_CONFIG).doc('credentials'), { whapiToken: loaded.migrationToken }, { merge: true })
      batch.set(db.collection(C.APP_CONFIG).doc('default'), { whapi: { enabled: next.enabled && next.defaultProvider === 'whapi',
        features: next.features, channelId: next.whapi.channelId, apiToken: FieldValue.delete() } }, { merge: true })
      batch.create(db.collection(C.AUDIT_LOGS).doc(), { action: 'whatsapp-config', operatorId: identity.uid, createdAt: Timestamp.now() })
      await batch.commit()
      return reply(200, { config: next, whapiCredentials: !!loaded.token, whapiVerified: verified })
    }
    if (input.action === 'health') {
      if (!manager) return reply(403)
      if (!loaded.token) throw fail('credentials-missing', 409)
      const response = await fetch('https://gate.whapi.cloud/health', { headers: { Authorization: `Bearer ${loaded.token}` }, signal: AbortSignal.timeout(8000) })
      if (!response.ok) {
        await ref.set({ whapiVerified: false }, { merge: true })
        throw fail('connection-failed', 503)
      }
      const health = await response.json()
      const operational = (health.status || health.health?.status)?.text === 'AUTH'
      if (!operational || (config.whapi.channelId && health.channel_id && health.channel_id !== config.whapi.channelId)) {
        await ref.set({ whapiVerified: false }, { merge: true })
        throw fail('connection-failed', 503)
      }
      await ref.set({ config, whapiVerified: true, whapiTokenHash: loaded.tokenHash, verifiedAt: Timestamp.now() }, { merge: true })
      return reply(200, { ...state(), whapiVerified: true })
    }
    if (input.action === 'records') {
      const records = await db.collection(C.WHATSAPP_TASKS).orderBy('createdAt', 'desc').limit(50).get()
      return reply(200, { records: records.docs.map(document => { const data = document.data(); return {
        id: document.id, provider: data.provider, status: data.status, phone: data.phone,
        kind: data.kind, test: !!data.test, createdAt: data.createdAt?.toDate?.().toISOString() || null,
      } }) })
    }
    if (!['send', 'test', 'manual'].includes(input.action)) return reply(400)
    if (input.kind != null && !['custom', 'event_reminder', 'vip_expiry', 'password_reset'].includes(input.kind)) return reply(400)
    const phone = typeof input.phone === 'string' ? normalizePhoneNumber(input.phone) : null
    if (!phone || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000
      || typeof input.requestId !== 'string' || !/^[\w-]{8,100}$/.test(input.requestId)) return reply(400)
    const test = input.action === 'test'
    if (test && (!manager || !config.testPhones.includes(phone))) throw fail('test-number-required', 403)
    if (!test && !config.enabled) throw fail('sending-paused', 409)
    const provider = input.action === 'manual' ? 'manual' : test ? 'whapi' : config.defaultProvider
    if (input.action === 'manual' && !admin) return reply(403)
    if (provider !== 'manual' && provider !== 'whapi') throw fail('channel-unavailable', 409)
    if (provider === 'manual' && input.action !== 'manual') throw fail('manual-action-required', 409)
    if (provider === 'whapi' && (!loaded.token || !loaded.verified)) throw fail('verification-required', 409)
    if (!test && input.action !== 'manual') {
      if (typeof input.userId !== 'string' || input.userId.includes('/')) return reply(400)
      const member = (await db.collection(C.USERS).doc(input.userId).get()).data()
      if (!member || (!admin && (member.authUid || input.userId) !== identity.uid)) return reply(403)
      if (normalizePhoneNumber(member.profile?.phone || member.phone || '') !== phone) return reply(409)
      if (member.preferences?.whatsapp !== true) throw fail('consent-required', 409)
      const feature = { event_reminder: 'eventReminder', vip_expiry: 'vipExpiry', password_reset: 'passwordReset' }[input.kind as string]
      if (feature && !config.features[feature as keyof typeof config.features]) throw fail('feature-disabled', 409)
    }
    const id = createHash('sha256').update(`${identity.uid}:${input.requestId}`).digest('hex')
    const task = db.collection(C.WHATSAPP_TASKS).doc(id)
    const fingerprint = createHash('sha256').update(JSON.stringify([provider, phone, input.text, input.kind || 'custom', test])).digest('hex')
    const attempt = db.collection(C.WHATSAPP_ATTEMPTS).doc(identity.uid)
    const result = await db.runTransaction(async transaction => {
      const existing = await transaction.get(task)
      if (existing.exists) {
        if (existing.data()?.fingerprint !== fingerprint) throw fail('request-conflict', 409)
        return existing.data()?.status || 'unknown'
      }
      const counter = (await transaction.get(attempt)).data()
      const count = counter && counter.expiresAtMs > Date.now() ? Number(counter.count) || 0 : 0
      if (count >= 20) throw fail('too-many-requests', 429)
      transaction.set(attempt, { count: count + 1, expiresAtMs: counter && counter.expiresAtMs > Date.now() ? counter.expiresAtMs : Date.now() + 300000 })
      transaction.create(task, { provider, phone: `***${phone.slice(-4)}`, fingerprint, kind: input.kind || 'custom', test,
        status: provider === 'manual' ? 'opened' : 'submitting', createdAt: Timestamp.now(), operatorId: identity.uid })
      return null
    })
    if (result) return reply(200, { status: result, taskId: id })
    if (provider === 'manual') return reply(200, { status: 'opened', taskId: id })
    let submitted
    try { submitted = await submitWhapi(loaded.token, phone, input.text) } catch { submitted = { status: 'unknown', messageId: '' } }
    await task.update({ ...submitted, updatedAt: Timestamp.now() })
    return reply(200, { ...submitted, taskId: id })
  } catch (error) {
    const safe = error as { status?: number; code?: string }
    return reply(safe.status || 503, { code: safe.status ? safe.code : 'service-unavailable' })
  }
}

export default toWebFunction(eventHandler)
