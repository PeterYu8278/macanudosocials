import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections'
import { formatWhatsAppMessage } from '../../../src/utils/whatsappMessage'
import { connectionError, decryptWhatsAppToken, encryptWhatsAppToken, tokenDigest } from './whatsappCredentials'
import { defaultWhatsAppSettings } from '../../../src/types/whatsapp'

export function registeredGateways(): Record<string, string> {
  try {
    const input = JSON.parse(process.env.WHATSMEOW_GATEWAYS || '{}')
    const result: Record<string, string> = Object.create(null)
    for (const [id, value] of Object.entries(input)) {
      if (!/^[\w-]{1,80}$/.test(id) || typeof value !== 'string') continue
      const url = new URL(value)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') continue
      result[id] = url.origin
    }
    return result
  } catch { return {} }
}

export async function gatewayRequest(baseUrl: string, token: string, path: '/v1/status' | '/v1/pair' | '/v1/messages', body?: unknown) {
  if (!Object.values(registeredGateways()).includes(baseUrl)) throw connectionError('gateway-not-registered', 503)
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
  })
  const reader = response.body?.getReader()
  let size = 0
  const chunks: Uint8Array[] = []
  if (!reader) throw connectionError('gateway-unavailable', 503)
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 16000) throw connectionError('gateway-invalid-response', 503)
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  if (!response.ok) throw connectionError('gateway-unavailable', response.status === 409 ? 409 : 503)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function validGatewayStatus(value: any) {
  if (!value || typeof value.sessionId !== 'string' || !/^[\w-]{1,100}$/.test(value.sessionId) || !['connected', 'disconnected', 'qr'].includes(value.status)
    || (value.account && !/^\+[1-9]\d{6,14}$/.test(value.account))) throw connectionError('gateway-invalid-response', 503)
  return value as { sessionId: string; status: string; account: string; qr?: string; qrExpiresAtMs?: number }
}

export async function loadMeow(db: Firestore) {
  const data = (await db.collection(C.WHATSAPP_CONFIG).doc('whatsmeow-active').get()).data()
  if (!data) throw connectionError('verification-required')
  const baseUrl = registeredGateways()[data.gatewayId]
  if (!baseUrl || data.baseUrl !== baseUrl) throw connectionError('gateway-not-registered', 503)
  const token = decryptWhatsAppToken(data.ciphertext, `whatsmeow:${data.gatewayId}`)
  if (tokenDigest(token) !== data.tokenHash) throw connectionError('credentials-invalid', 503)
  return { ...data, baseUrl, token } as typeof data & { gatewayId: string; baseUrl: string; token: string; sessionId: string; account: string; version: string }
}

export async function assertMeowBinding(db: Firestore, tx: any, active: Awaited<ReturnType<typeof loadMeow>>) {
  const saved = (await tx.get(db.collection(C.WHATSAPP_CONFIG).doc('whatsmeow-active'))).data()
  const settings = (await tx.get(db.collection(C.WHATSAPP_CONFIG).doc('settings'))).data()
  if (saved?.version !== active.version || settings?.config?.defaultProvider !== 'whatsmeow') throw connectionError('connection-changed')
}

export async function submitMeow(active: Awaited<ReturnType<typeof loadMeow>>, requestId: string, phone: string, text: string, expiresAtMs: number) {
  const result = await gatewayRequest(active.baseUrl, active.token, '/v1/messages', {
    requestId, phone, text: formatWhatsAppMessage(text), expiresAtMs, sessionId: active.sessionId, account: active.account,
  })
  if (!['queued', 'submitting', 'sent', 'unknown', 'failed'].includes(result.status) || typeof result.messageId !== 'string' || !result.messageId || result.messageId.length > 200) throw connectionError('gateway-invalid-response', 503)
  return { status: result.status === 'queued' ? 'accepted' : result.status, messageId: result.messageId }
}

export async function manageMeow(db: Firestore, owner: string, input: any) {
  const ref = db.collection(C.WHATSAPP_CONFIG).doc(`whatsmeow-candidate-${tokenDigest(owner)}`)
  if (input.action === 'meow-stage') {
    const baseUrl = registeredGateways()[input.gatewayId]
    if (!baseUrl || typeof input.token !== 'string' || input.token.length < 32 || input.token.length > 2000) throw connectionError('gateway-not-registered')
    const existing = (await ref.get()).data()
    if (existing?.stagedAtMs > Date.now() - 10000) throw connectionError('connection-busy', 429)
    const token = input.token.trim()
    const health = validGatewayStatus(await gatewayRequest(baseUrl, token, '/v1/status'))
    const settings = (await db.collection(C.WHATSAPP_CONFIG).doc('settings').get()).data()
    await ref.set({ id: randomUUID(), gatewayId: input.gatewayId, baseUrl,
      ciphertext: encryptWhatsAppToken(token, `whatsmeow:${input.gatewayId}`), tokenHash: tokenDigest(token),
      sessionId: health.sessionId, owner, stagedAtMs: Date.now(), expiresAtMs: Date.now() + 10 * 60000,
      previous: tokenDigest(JSON.stringify(settings?.config || null)) })
    return { staged: true }
  }
  const candidate = (await ref.get()).data()
  if (!candidate || candidate.owner !== owner || candidate.expiresAtMs < Date.now()) throw connectionError('connection-expired')
  if (registeredGateways()[candidate.gatewayId] !== candidate.baseUrl) throw connectionError('gateway-not-registered')
  const token = decryptWhatsAppToken(candidate.ciphertext, `whatsmeow:${candidate.gatewayId}`)
  const allowed = await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data()
    if (current?.id !== candidate.id || current.expiresAtMs < Date.now()) throw connectionError('connection-expired')
    const field = input.action === 'meow-status' ? 'lastCheckMs' : 'lastActionMs'
    if (current[field] > Date.now() - (field === 'lastCheckMs' ? 3000 : 1000)) return false
    tx.update(ref, { [field]: Date.now() })
    return true
  })
  if (!allowed) throw connectionError('connection-busy', 429)
  if (input.action === 'meow-pair') {
    await gatewayRequest(candidate.baseUrl, token, '/v1/pair', {})
    return { status: 'connecting' }
  }
  const health = validGatewayStatus(await gatewayRequest(candidate.baseUrl, token, '/v1/status'))
  if (health.sessionId !== candidate.sessionId) throw connectionError('connection-changed')
  if (input.action === 'meow-status') return { sessionId: health.sessionId, status: health.status,
    account: health.account ? `***${health.account.slice(-4)}` : '',
    qr: health.status === 'qr' && typeof health.qr === 'string' && health.qr.length < 4000 && (health.qrExpiresAtMs || 0) > Date.now() ? health.qr : '',
    qrExpiresAtMs: Math.min(health.qrExpiresAtMs || 0, Date.now() + 20000) }
  if (input.action !== 'meow-activate' || input.confirm !== true || health.status !== 'connected' || input.account !== health.account) throw connectionError('account-mismatch')
  await db.runTransaction(async tx => {
    const settingsRef = db.collection(C.WHATSAPP_CONFIG).doc('settings')
    const settings = (await tx.get(settingsRef)).data()
    const current = (await tx.get(ref)).data()
    if (current?.id !== candidate.id || current.expiresAtMs < Date.now()
      || candidate.previous !== tokenDigest(JSON.stringify(settings?.config || null))) throw connectionError('connection-changed')
    const active = { gatewayId: candidate.gatewayId, baseUrl: candidate.baseUrl, ciphertext: candidate.ciphertext,
      tokenHash: candidate.tokenHash, sessionId: health.sessionId, account: health.account, version: randomUUID(), activatedAtMs: Date.now(), activatedBy: owner }
    tx.set(db.collection(C.WHATSAPP_CONFIG).doc('whatsmeow-active'), active)
    tx.set(settingsRef, { config: { ...defaultWhatsAppSettings, ...settings?.config, defaultProvider: 'whatsmeow',
      whatsmeow: { baseUrl: candidate.baseUrl, phone: health.account } } }, { merge: true })
    tx.create(db.collection(C.AUDIT_LOGS).doc(), { action: 'whatsmeow-activate', operatorId: owner,
      gatewayId: candidate.gatewayId, sessionId: health.sessionId, version: active.version, createdAt: new Date() })
    tx.delete(ref)
  })
  return { activated: true }
}

export function verifyGatewayCallback(headers: Record<string, string | undefined>, body: string, key: string, now = Date.now()) {
  const stamp = headers['x-gateway-timestamp'] || '', id = headers['x-gateway-event'] || ''
  const signature = headers['x-gateway-signature'] || ''
  if (key.length < 32 || !/^\d{10}$/.test(stamp) || Math.abs(now - Number(stamp) * 1000) > 300000
    || !/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(signature)) return false
  const expected = createHmac('sha256', key).update(`${stamp}.${id}.${body}`).digest()
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
}
