import { randomUUID } from 'node:crypto'
import { Timestamp, FieldValue, type Firestore } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections'
import { assertWhatsAppBinding, loadWhatsApp } from './whatsapp'
import { connectionError as fail, credentialEncryptionReady, decryptWhatsAppToken, encryptWhatsAppToken, tokenDigest } from './whatsappCredentials'

const SESSION_MS = 5 * 60000
const CANDIDATE_MS = 20 * 60000
const ref = (db: Firestore, id: string) => db.collection(C.WHATSAPP_CONFIG).doc(id)
const validId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]{1,200}$/.test(value)
const mask = (value: string) => value.length > 4 ? `***${value.slice(-4)}` : '***'
export function connectionSummary(candidate: any, session: any, owner: string) {
  return {
    encryptionReady: credentialEncryptionReady(),
    candidate: candidate && candidate.owner === owner && candidate.expiresAtMs > Date.now() ? {
      id: candidate.id, channelId: candidate.channelId, expiresAtMs: candidate.expiresAtMs,
      verified: !!candidate.verifiedAtMs, account: candidate.account ? mask(candidate.account) : null,
    } : null,
    connectionBusy: !!session && session.owner !== owner && session.expiresAtMs > Date.now(),
  }
}

async function boundedBody(response: Response, max: number) {
  if (Number(response.headers.get('content-length')) > max) throw fail('provider-response-invalid', 502)
  const reader = response.body?.getReader()
  if (!reader) throw fail('provider-response-invalid', 502)
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > max) { await reader.cancel(); throw fail('provider-response-invalid', 502) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  return Buffer.concat(chunks)
}
async function provider(token: string, endpoint: 'health' | 'users/login/image') {
  return fetch(`https://gate.whapi.cloud/${endpoint}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: endpoint === 'health' ? 'application/json' : 'image/png' },
    signal: AbortSignal.timeout(8000), redirect: 'error', cache: 'no-store',
  })
}
export async function readWhapiHealth(token: string, expectedChannel: string) {
  const checkedAtMs = Date.now()
  const response = await provider(token, 'health')
  if (response.status === 401 || response.status === 403 || response.status === 404) throw fail('credentials-invalid')
  if (!response.ok) throw fail('connection-unavailable', 503)
  let body: any
  try { body = JSON.parse((await boundedBody(response, 32768)).toString('utf8')) } catch { throw fail('provider-response-invalid', 502) }
  const channelId = body.channel_id || body.channel?.id
  if (typeof channelId !== 'string' || channelId !== expectedChannel) throw fail('channel-mismatch')
  const rawStatus = (body.status || body.health?.status)?.text
  const account = typeof body.user?.id === 'string' || typeof body.user?.id === 'number' ? String(body.user.id) : ''
  const status = rawStatus === 'AUTH' ? 'connected' : rawStatus === 'QR' ? 'qr'
    : ['INIT', 'LAUNCH'].includes(rawStatus) ? 'connecting' : rawStatus === 'STOP' ? 'stopped' : 'disconnected'
  if (status === 'connected' && !/^\d{6,20}$/.test(account)) throw fail('identity-missing')
  return { status, account, channelId, checkedAtMs }
}

export async function refreshWhapiConnection(db: Firestore, channelId: string) {
  const loaded = await loadWhatsApp(db)
  if (!loaded.managed || !loaded.token || loaded.config.whapi.channelId !== channelId) return
  // Provider events are only a hint: re-read live health, never trust an event's AUTH/QR value.
  let health: Awaited<ReturnType<typeof readWhapiHealth>> | null = null
  let invalid = false
  const startedAtMs = Date.now()
  try { health = await readWhapiHealth(loaded.token, channelId) }
  catch (error) { invalid = ['credentials-invalid', 'channel-mismatch', 'identity-missing'].includes((error as any)?.code) }
  await db.runTransaction(async tx => {
    const settingsRef = ref(db, 'settings')
    const settings = (await tx.get(settingsRef)).data()
    await assertWhatsAppBinding(db, tx, loaded.binding)
    if (settings?.whapiCheckedAtMs > (health?.checkedAtMs || startedAtMs)) return
    const verified = health?.status === 'connected' && settings?.whapiUserId === health.account
    tx.set(settingsRef, { whapiConnectionStatus: health?.status === 'connected' && !verified ? 'unknown' : health?.status || 'unknown',
      whapiCheckedAtMs: health?.checkedAtMs || startedAtMs, whapiWebhookAt: Timestamp.now(),
      ...(health || invalid ? { whapiVerified: verified, whapiTokenHash: verified ? loaded.tokenHash : '' } : {}),
    }, { merge: true })
  })
}

// These operations are called only after the management endpoint checks the manager role.
export async function manageWhatsAppConnection(db: Firestore, owner: string, input: any) {
  const loaded = await loadWhatsApp(db)
  const candidateRef = ref(db, 'candidate'), sessionRef = ref(db, 'connection-session'), settingsRef = ref(db, 'settings')
  const now = Date.now()
  if (['candidate-save', 'candidate-migrate', 'candidate-activate', 'connection-start'].includes(input.action)) {
    const limitRef = db.collection(C.WHATSAPP_ATTEMPTS).doc(`connection-${tokenDigest(owner)}`)
    await db.runTransaction(async tx => {
      const previous = (await tx.get(limitRef)).data()
      const current = previous?.expiresAtMs > now ? previous : { count: 0, expiresAtMs: now + 300000 }
      if (current.count >= 20) throw fail('too-many-requests', 429)
      tx.set(limitRef, { count: current.count + 1, expiresAtMs: current.expiresAtMs })
    })
  }
  if (input.action === 'candidate-save' || input.action === 'candidate-migrate') {
    const migrating = input.action === 'candidate-migrate'
    const token = migrating ? loaded.token : typeof input.token === 'string' ? input.token.trim() : ''
    const channelId = migrating ? loaded.config.whapi.channelId : input.channelId
    if (!validId(channelId) || !token || token.length > 4096 || /\s/.test(token)) throw fail('invalid-credentials', 400)
    const id = randomUUID(), ciphertext = encryptWhatsAppToken(token, channelId)
    await db.runTransaction(async tx => {
      const session = (await tx.get(sessionRef)).data()
      const candidate = (await tx.get(candidateRef)).data()
      await assertWhatsAppBinding(db, tx, loaded.binding)
      if ((session?.expiresAtMs > now && session.owner !== owner)
        || (candidate?.expiresAtMs > now && candidate.owner !== owner)) throw fail('connection-busy')
      tx.set(candidateRef, { id, channelId, ciphertext, tokenHash: tokenDigest(token), owner,
        activeBinding: loaded.binding, expiresAtMs: now + CANDIDATE_MS, createdAt: Timestamp.now() })
      tx.set(sessionRef, { expiresAtMs: 0 })
      tx.create(db.collection(C.AUDIT_LOGS).doc(), { action: 'whatsapp-candidate-saved', operatorId: owner, channelId, createdAt: Timestamp.now() })
    })
    return { candidate: { id, channelId, expiresAtMs: now + CANDIDATE_MS, verified: false, account: null } }
  }

  if (input.action === 'connection-start') {
    const target = input.target === 'candidate' ? 'candidate' : input.target === 'active' ? 'active' : null
    if (!target) throw fail('invalid-request', 400)
    const id = randomUUID()
    const session = await db.runTransaction(async tx => {
      const previous = (await tx.get(sessionRef)).data()
      const candidate = (await tx.get(candidateRef)).data()
      await assertWhatsAppBinding(db, tx, loaded.binding)
      if (previous?.expiresAtMs > now && previous.owner !== owner) throw fail('connection-busy')
      if (target === 'candidate' && (!candidate || candidate.owner !== owner || candidate.id !== input.candidateId
        || candidate.expiresAtMs <= now || candidate.activeBinding !== loaded.binding)) throw fail('candidate-expired')
      if (target === 'active' && (!loaded.token || !validId(loaded.config.whapi.channelId))) throw fail('credentials-missing')
      const value = { id, owner, target, candidateId: target === 'candidate' ? candidate!.id : '',
        activeBinding: loaded.binding, channelId: target === 'candidate' ? candidate!.channelId : loaded.config.whapi.channelId,
        expiresAtMs: now + SESSION_MS, busyUntilMs: 0, status: 'unknown', createdAt: Timestamp.now() }
      if (previous?.busyUntilMs > now) throw fail('connection-busy')
      tx.set(sessionRef, value)
      tx.create(db.collection(C.AUDIT_LOGS).doc(), { action: 'whatsapp-connection-start', operatorId: owner, target, createdAt: Timestamp.now() })
      return value
    })
    return { session: { id: session.id, target: session.target, channelId: session.channelId, expiresAtMs: session.expiresAtMs, status: session.status } }
  }

  if (input.action === 'candidate-activate') {
    const candidate = (await candidateRef.get()).data()
    if (!candidate || candidate.owner !== owner || candidate.id !== input.candidateId || candidate.expiresAtMs <= now
      || candidate.activeBinding !== loaded.binding || !candidate.verifiedAtMs || input.confirm !== true) throw fail('candidate-expired')
    const token = decryptWhatsAppToken(candidate.ciphertext, candidate.channelId)
    const health = await readWhapiHealth(token, candidate.channelId)
    if (health.status !== 'connected' || health.account !== candidate.account) throw fail('verification-required')
    const version = randomUUID()
    await db.runTransaction(async tx => {
      const fresh = (await tx.get(candidateRef)).data()
      const session = (await tx.get(sessionRef)).data()
      const settings = (await tx.get(settingsRef)).data()
      await assertWhatsAppBinding(db, tx, loaded.binding)
      if (!fresh || fresh.id !== candidate.id || fresh.owner !== owner || fresh.expiresAtMs <= Date.now()
        || fresh.tokenHash !== candidate.tokenHash || fresh.account !== health.account) throw fail('connection-changed')
      if (session?.busyUntilMs > Date.now() || (session?.expiresAtMs > Date.now() && session.owner !== owner)) throw fail('connection-busy')
      const config = { ...(settings?.config || loaded.config), whapi: { channelId: candidate.channelId } }
      tx.set(ref(db, 'credentials'), { version, channelId: candidate.channelId, ciphertext: candidate.ciphertext, tokenHash: candidate.tokenHash })
      if (loaded.config.whapi.channelId) tx.set(ref(db, `retired-${tokenDigest(loaded.config.whapi.channelId)}`), {
        channelId: loaded.config.whapi.channelId, version: loaded.credentialVersion, retiredAt: Timestamp.now(),
      })
      tx.set(settingsRef, { config, credentialMode: 'managed', credentialVersion: version,
        whapiVerified: true, whapiTokenHash: candidate.tokenHash, whapiUserId: health.account,
        whapiConnectionStatus: 'connected', whapiCheckedAtMs: health.checkedAtMs, verifiedAt: Timestamp.now(), updatedBy: owner }, { merge: true })
      tx.set(candidateRef, { expiresAtMs: 0 })
      tx.set(sessionRef, { expiresAtMs: 0 })
      tx.set(db.collection(C.APP_CONFIG).doc('default'), { whapi: { apiToken: FieldValue.delete(), channelId: candidate.channelId } }, { merge: true })
      tx.create(db.collection(C.AUDIT_LOGS).doc(), { action: 'whatsapp-channel-activated', operatorId: owner,
        previousChannelId: loaded.config.whapi.channelId, channelId: candidate.channelId, version, createdAt: Timestamp.now() })
    })
    return { activated: true }
  }

  if (!validId(input.sessionId)) throw fail('session-expired')
  const leaseId = randomUUID()
  const claim = await db.runTransaction(async tx => {
    const session = (await tx.get(sessionRef)).data()
    const candidate = (await tx.get(candidateRef)).data()
    await assertWhatsAppBinding(db, tx, loaded.binding)
    if (!session || session.id !== input.sessionId || session.owner !== owner || session.expiresAtMs <= now
      || session.activeBinding !== loaded.binding) throw fail('session-expired')
    if (input.action === 'connection-cancel') { tx.set(sessionRef, { expiresAtMs: 0 }); return null }
    if (session.busyUntilMs > now) throw fail('connection-busy')
    if (session.target === 'candidate' && (!candidate || candidate.id !== session.candidateId || candidate.owner !== owner
      || candidate.expiresAtMs <= now)) throw fail('candidate-expired')
    const qr = input.action === 'connection-qr'
    if (qr && !['qr', 'connecting'].includes(session.status)) throw fail('verification-required')
    const last = qr ? session.qrAtMs : session.checkedAtMs
    if (last && now - last < (qr ? 10000 : 3000)) throw fail('too-many-requests', 429)
    const token = session.target === 'candidate' ? decryptWhatsAppToken(candidate!.ciphertext, session.channelId) : loaded.token
    if (!token) throw fail('credentials-missing')
    tx.update(sessionRef, { leaseId, busyUntilMs: now + 12000, [qr ? 'qrAtMs' : 'checkedAtMs']: now })
    return { session, token, candidate }
  })
  if (!claim) return { cancelled: true }
  const finish = async (health?: Awaited<ReturnType<typeof readWhapiHealth>>) => {
    await db.runTransaction(async tx => {
      const current = (await tx.get(sessionRef)).data()
      const candidate = (await tx.get(candidateRef)).data()
      const settings = (await tx.get(settingsRef)).data()
      await assertWhatsAppBinding(db, tx, loaded.binding)
      if (!current || current.id !== input.sessionId || current.owner !== owner || current.leaseId !== leaseId
        || current.expiresAtMs <= Date.now()) throw fail('session-expired')
      if (current.target === 'candidate' && candidate?.id !== current.candidateId) throw fail('candidate-expired')
      if (health?.status === 'connected' && current.target === 'active' && settings?.whapiUserId && settings.whapiUserId !== health.account) throw fail('account-mismatch')
      if (health && current.target === 'active' && settings?.whapiCheckedAtMs > health.checkedAtMs) throw fail('connection-busy')
      tx.update(sessionRef, { busyUntilMs: 0, ...(health ? { status: health.status } : {}) })
      if (health && current.target === 'candidate') tx.update(candidateRef, {
        account: health.status === 'connected' ? health.account : '', verifiedAtMs: health.status === 'connected' ? Date.now() : 0,
      })
      if (health && current.target === 'active') tx.set(settingsRef, {
        whapiConnectionStatus: health.status, whapiVerified: health.status === 'connected',
        whapiCheckedAtMs: health.checkedAtMs,
        whapiTokenHash: health.status === 'connected' ? loaded.tokenHash : '',
        ...(health.status === 'connected' ? { whapiUserId: health.account, verifiedAt: Timestamp.now() } : {}),
      }, { merge: true })
    })
  }
  try {
    if (input.action === 'connection-status') {
      const health = await readWhapiHealth(claim.token, claim.session.channelId)
      await finish(health)
      return { status: health.status, account: health.account ? mask(health.account) : null }
    }
    const response = await provider(claim.token, 'users/login/image')
    if (response.status === 409) { await finish(); return { status: 'connecting', qr: null } }
    if (response.status === 406) throw fail('qr-unsupported')
    if (response.status === 401 || response.status === 403) throw fail('credentials-invalid')
    if (!response.ok) throw fail('connection-unavailable', 503)
    const png = await boundedBody(response, 192 * 1024)
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw fail('provider-response-invalid', 502)
    await finish()
    return { status: 'qr', qr: `data:image/png;base64,${png.toString('base64')}`, qrExpiresAtMs: Math.min(claim.session.expiresAtMs, Date.now() + 20000) }
  } catch (error) {
    // Release only our lease. Never persist raw provider responses or sensitive QR material.
    await db.runTransaction(async tx => {
      const current = (await tx.get(sessionRef)).data()
      const revoke = claim.session.target === 'active' && ['credentials-invalid', 'account-mismatch', 'channel-mismatch', 'identity-missing'].includes((error as any)?.code)
      if (revoke) await assertWhatsAppBinding(db, tx, loaded.binding)
      if (current?.id === input.sessionId && current.leaseId === leaseId) tx.update(sessionRef, { busyUntilMs: 0, status: 'unknown' })
      if (revoke) tx.set(settingsRef, { whapiVerified: false, whapiConnectionStatus: 'unknown' }, { merge: true })
    })
    if ((error as any)?.code) throw error
    throw fail('connection-unavailable', 503)
  }
}
