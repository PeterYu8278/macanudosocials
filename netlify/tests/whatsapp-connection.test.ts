// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
import { defaultWhatsAppSettings } from '../../src/types/whatsapp'
import { decryptWhatsAppToken, encryptWhatsAppToken } from '../functions/_shared/whatsappCredentials'
import { loadWhatsApp } from '../functions/_shared/whatsapp'
import { connectionSummary, manageWhatsAppConnection, refreshWhapiConnection } from '../functions/_shared/whatsappConnection'

const docs = new Map<string, any>()
const fetchMock = vi.fn()
const path = (id: string) => `${C.WHATSAPP_CONFIG}/${id}`
const merge = (old: any, next: any): any => Object.fromEntries(Object.entries({ ...old, ...next }).map(([k, v]) => [k,
  v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype ? merge(old?.[k], v) : v]))
const snap = (p: string) => ({ exists: docs.has(p), data: () => docs.get(p) })
let sequence = 0
const db = {
  collection: (name: string) => ({ doc: (id = `auto-${++sequence}`) => ({ path: `${name}/${id}`, get: async () => snap(`${name}/${id}`) }) }),
  runTransaction: async (fn: any) => {
    const mutations: Array<() => void> = []
    const write = (r: any, value: any, options?: any) => mutations.push(() => docs.set(r.path, options?.merge ? merge(docs.get(r.path), value) : value))
    const result = await fn({ get: async (r: any) => {
      if (mutations.length) throw new Error('read-after-write')
      return snap(r.path)
    }, set: write, update: (r: any, value: any) => write(r, value, { merge: true }), create: write })
    mutations.forEach(apply => apply())
    return result
  },
} as unknown as Firestore
const digest = (v: string) => createHash('sha256').update(v).digest('hex')
const call = (action: string, input = {}, owner = 'manager') => manageWhatsAppConnection(db, owner, { action, ...input })
const health = (channel = 'new-channel', account = '60123456789', status = 'AUTH') => new Response(JSON.stringify({ channel_id: channel, status: { text: status }, user: account ? { id: account } : {} }))
const candidate = () => docs.get(path('candidate'))
const session = () => docs.get(path('connection-session'))
async function prepare() {
  await call('candidate-save', { channelId: 'new-channel', token: 'new-secret-token' })
  await call('connection-start', { target: 'candidate', candidateId: candidate().id })
  fetchMock.mockImplementation(async () => health())
  await call('connection-status', { sessionId: session().id })
}

describe('managed WhatsApp connections', () => {
  beforeEach(() => {
    docs.clear(); sequence = 0; fetchMock.mockReset()
    vi.stubEnv('WHAPI_API_TOKEN', 'old-environment-token')
    vi.stubEnv('WHATSAPP_CREDENTIAL_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'))
    vi.stubGlobal('fetch', fetchMock)
    docs.set(path('settings'), { config: { ...defaultWhatsAppSettings, enabled: true, defaultProvider: 'whapi', whapi: { channelId: 'old-channel' } },
      whapiVerified: true, whapiTokenHash: digest('old-environment-token'), whapiUserId: '60111111111' })
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

  it('requires a separate encryption key and authenticates ciphertext to its channel', () => {
    const ciphertext = encryptWhatsAppToken('sensitive', 'one')
    expect(ciphertext).not.toContain('sensitive')
    expect(decryptWhatsAppToken(ciphertext, 'one')).toBe('sensitive')
    expect(() => decryptWhatsAppToken(ciphertext, 'two')).toThrow('credentials-invalid')
    expect(() => decryptWhatsAppToken(`${ciphertext}corrupt`, 'one')).toThrow('credentials-invalid')
    vi.stubEnv('WHATSAPP_CREDENTIAL_ENCRYPTION_KEY', '')
    expect(() => encryptWhatsAppToken('sensitive', 'one')).toThrow('encryption-key-missing')
  })
  it('preserves the active channel while encrypting a candidate and hiding secrets from summaries', async () => {
    const result = await call('candidate-save', { channelId: 'new-channel', token: 'new-secret-token' })
    expect((await loadWhatsApp(db)).token).toBe('old-environment-token')
    expect(docs.get(path('settings')).config.whapi.channelId).toBe('old-channel')
    expect(JSON.stringify([...docs.values()])).not.toContain('new-secret-token')
    expect(JSON.stringify(result)).not.toContain('ciphertext')
    expect(connectionSummary(candidate(), null, 'other').candidate).toBeNull()
  })
  it('migrates the effective environment token, not a stale database token', async () => {
    docs.set(path('credentials'), { whapiToken: 'stale-database-token' })
    await call('candidate-migrate')
    expect(decryptWhatsAppToken(candidate().ciphertext, 'old-channel')).toBe('old-environment-token')
  })
  it('activates only after live verification and explicit confirmation; managed failures never fall back', async () => {
    await prepare()
    const id = candidate().id
    await expect(call('candidate-activate', { candidateId: id })).rejects.toThrow('candidate-expired')
    await call('candidate-activate', { candidateId: id, confirm: true })
    expect(fetchMock.mock.calls.every(([url]) => url === 'https://gate.whapi.cloud/health')).toBe(true)
    expect((await loadWhatsApp(db))).toMatchObject({ token: 'new-secret-token', managed: true, verified: true })
    expect(docs.get(path(`retired-${digest('old-channel')}`)).channelId).toBe('old-channel')
    expect(docs.get(path('credentials')).whapiToken).toBeUndefined()
    vi.stubEnv('WHATSAPP_CREDENTIAL_ENCRYPTION_KEY', Buffer.alloc(32, 8).toString('base64'))
    expect((await loadWhatsApp(db))).toMatchObject({ token: '', credentialsInvalid: true, verified: false, managed: true })
  })
  it('does not activate a different account after candidate verification', async () => {
    await prepare()
    fetchMock.mockResolvedValue(health('new-channel', '60999999999'))
    await expect(call('candidate-activate', { candidateId: candidate().id, confirm: true })).rejects.toThrow('verification-required')
    expect((await loadWhatsApp(db)).token).toBe('old-environment-token')
  })
  it('rejects stale activation when another channel version changes during the health request', async () => {
    await prepare()
    fetchMock.mockImplementation(async () => {
      docs.get(path('settings')).config.whapi.channelId = 'changed-channel'
      return health()
    })
    await expect(call('candidate-activate', { candidateId: candidate().id, confirm: true })).rejects.toThrow('connection-changed')
    expect(docs.get(path('credentials'))).toBeUndefined()
  })
  it('enforces owner leases, expiry and active channel binding', async () => {
    await call('candidate-save', { channelId: 'new-channel', token: 'new-secret-token' })
    await expect(call('candidate-save', { channelId: 'other', token: 'another-token' }, 'other')).rejects.toThrow('connection-busy')
    await call('connection-start', { target: 'candidate', candidateId: candidate().id })
    await expect(call('connection-status', { sessionId: session().id }, 'other')).rejects.toThrow('session-expired')
    session().expiresAtMs = 0
    await expect(call('connection-status', { sessionId: session().id })).rejects.toThrow('session-expired')
    candidate().expiresAtMs = 0
    await expect(call('connection-start', { target: 'candidate', candidateId: candidate().id })).rejects.toThrow('candidate-expired')
  })
  it('returns a bounded PNG in memory only, then cancels without logout', async () => {
    vi.useFakeTimers()
    await call('connection-start', { target: 'active' })
    const id = session().id
    fetchMock.mockResolvedValueOnce(health('old-channel', '', 'QR'))
    await call('connection-status', { sessionId: id })
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
    fetchMock.mockResolvedValueOnce(new Response(png, { headers: { 'content-type': 'image/png' } }))
    const result = await call('connection-qr', { sessionId: id }) as any
    expect(result.qr).toBe(`data:image/png;base64,${png.toString('base64')}`)
    expect(JSON.stringify([...docs.values()])).not.toContain('data:image')
    await expect(call('connection-qr', { sessionId: id })).rejects.toThrow('too-many-requests')
    await call('connection-cancel', { sessionId: id })
    expect(session().expiresAtMs).toBe(0)
    expect(fetchMock.mock.calls.some(([url]) => url.includes('logout'))).toBe(false)
  })
  it('rejects mismatched channels before generating QR codes', async () => {
    await call('connection-start', { target: 'active' })
    fetchMock.mockResolvedValue(health('wrong-channel', '', 'QR'))
    await expect(call('connection-status', { sessionId: session().id })).rejects.toThrow('channel-mismatch')
    await expect(call('connection-qr', { sessionId: session().id })).rejects.toThrow('verification-required')
  })
  it('rejects unsafe image payloads and handles unsupported channel types', async () => {
    await call('connection-start', { target: 'active' })
    fetchMock.mockResolvedValueOnce(health('old-channel', '', 'QR'))
    await call('connection-status', { sessionId: session().id })
    fetchMock.mockResolvedValueOnce(new Response('<script>bad</script>'))
    await expect(call('connection-qr', { sessionId: session().id })).rejects.toThrow('provider-response-invalid')
    session().qrAtMs = 0; session().status = 'qr'
    fetchMock.mockResolvedValueOnce(new Response('', { status: 406 }))
    await expect(call('connection-qr', { sessionId: session().id })).rejects.toThrow('qr-unsupported')
  })
  it('does not publish a QR response after the administrator cancels the session', async () => {
    await call('connection-start', { target: 'active' })
    fetchMock.mockResolvedValueOnce(health('old-channel', '', 'QR'))
    await call('connection-status', { sessionId: session().id })
    fetchMock.mockImplementationOnce(async () => {
      await call('connection-cancel', { sessionId: session().id })
      return new Response(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    })
    await expect(call('connection-qr', { sessionId: session().id })).rejects.toThrow('session-expired')
  })
  it('rechecks live health for callbacks and does not overwrite a newer observation', async () => {
    await prepare()
    await call('candidate-activate', { candidateId: candidate().id, confirm: true })
    fetchMock.mockImplementation(async () => health('new-channel', '', 'QR'))
    await refreshWhapiConnection(db, 'new-channel')
    expect(docs.get(path('settings'))).toMatchObject({ whapiVerified: false, whapiConnectionStatus: 'qr' })
    fetchMock.mockImplementation(async () => {
      docs.get(path('settings')).whapiCheckedAtMs = Date.now() + 1000
      return health()
    })
    await refreshWhapiConnection(db, 'new-channel')
    expect(docs.get(path('settings')).whapiVerified).toBe(false)
  })
  it('bounds management request frequency independently of sending rate limits', async () => {
    for (let count = 0; count < 20; count++) await call('candidate-save', { channelId: 'new-channel', token: 'new-secret-token' })
    await expect(call('candidate-save', { channelId: 'new-channel', token: 'new-secret-token' })).rejects.toThrow('too-many-requests')
  })
  it('rejects images larger than the response limit', async () => {
    await call('connection-start', { target: 'active' })
    fetchMock.mockResolvedValueOnce(health('old-channel', '', 'QR'))
    await call('connection-status', { sessionId: session().id })
    fetchMock.mockResolvedValueOnce(new Response(Buffer.alloc(200 * 1024)))
    await expect(call('connection-qr', { sessionId: session().id })).rejects.toThrow('provider-response-invalid')
  })
})
