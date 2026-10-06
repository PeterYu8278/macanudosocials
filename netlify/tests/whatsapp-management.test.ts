// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultWhatsAppSettings } from '../../src/types/whatsapp'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
import { createHash } from 'node:crypto'
const m = vi.hoisted(() => ({ documents: new Map<string, any>(), verify: vi.fn(), fetch: vi.fn() }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], cert: vi.fn(), initializeApp: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: m.verify }) }))
vi.mock('firebase-admin/firestore', () => {
  const snapshot = (path: string) => ({ exists: m.documents.has(path), data: () => m.documents.get(path) })
  const merge = (old: any, value: any): any => Object.fromEntries(Object.entries({ ...old, ...value }).filter(([, v]) => v !== 'DELETE').map(([k, v]) => [k,
    v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? merge(old?.[k], v) : v]))
  const ref = (path: string): any => ({ path, get: async () => snapshot(path),
    set: async (value: any, options: any) => m.documents.set(path, options?.merge ? merge(m.documents.get(path), value) : value),
    update: async (value: any) => m.documents.set(path, { ...m.documents.get(path), ...value }) })
  const batch = () => {
    const mutations: Array<() => void> = []
    return { set: (r: any, value: any, options: any) => mutations.push(() => m.documents.set(r.path, options?.merge ? merge(m.documents.get(r.path), value) : value)),
      create: (r: any, value: any) => mutations.push(() => m.documents.set(r.path, value)),
      commit: async () => mutations.forEach(fn => fn()) }
  }
  return { FieldValue: { delete: () => 'DELETE' }, Timestamp: { now: () => new Date() }, initializeFirestore: () => ({
    collection: (name: string) => ({ doc: (id = 'audit') => ref(`${name}/${id}`) }), batch,
    runTransaction: async (fn: any) => fn({ get: async (r: any) => snapshot(r.path),
      set: (r: any, value: any) => m.documents.set(r.path, value), create: (r: any, value: any) => m.documents.set(r.path, value) }),
  }) }
})
import webHandler, { eventHandler as handler } from '../functions/whatsapp-management'
const invoke = handler as unknown as (event: any) => Promise<{ statusCode: number; body: string }>
const request = (action: string, data = {}, headers: any = { authorization: 'Bearer test' }) => invoke({ httpMethod: 'POST', headers, body: JSON.stringify({ action, ...data }) })
const config = () => ({ ...defaultWhatsAppSettings, enabled: true, defaultProvider: 'whapi', testPhones: ['+60168008000'] })
const send = { phone: '0168008000', text: 'Test notification', requestId: 'request-12345' }
const verifiedState = (value = config()) => ({ config: value, whapiVerified: true,
  whapiTokenHash: createHash('sha256').update('private-test-token').digest('hex') })
describe('WhatsApp management gateway', () => {
  beforeEach(() => {
    vi.resetAllMocks(); m.documents.clear()
    vi.stubGlobal('fetch', m.fetch); vi.stubEnv('WHAPI_API_TOKEN', '')
    m.verify.mockResolvedValue({ uid: 'operator' })
    m.documents.set(`${C.USERS}/operator`, { role: 'developer' })
    m.documents.set(`${C.WHATSAPP_CONFIG}/settings`, verifiedState())
    m.documents.set(`${C.WHATSAPP_CONFIG}/credentials`, { whapiToken: 'private-test-token' })
    m.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'provider-message' }) })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('enforces authentication through the deployed modern entry point', async () => {
    const response = await webHandler(new Request('https://example.com/.netlify/functions/whatsapp-management', {
      method: 'POST', body: JSON.stringify({ action: 'load' }),
    }))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ success: false })
    expect(m.verify).not.toHaveBeenCalled()
  })
  it('never returns provider credentials to the browser', async () => {
    const response = await request('load')
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('private-test-token')
    expect(JSON.parse(response.body).whapiCredentials).toBe(true)
  })
  it('rejects anonymous and member management operations', async () => {
    expect((await request('load', {}, {})).statusCode).toBe(401)
    m.documents.set(`${C.USERS}/operator`, { role: 'member' })
    expect((await request('load')).statusCode).toBe(403)
    expect(m.fetch).not.toHaveBeenCalled()
  })
  it('limits configuration and tests to superAdmin/developer', async () => {
    m.documents.set(`${C.USERS}/operator`, { role: 'admin' })
    expect((await request('save', { config: config() })).statusCode).toBe(403)
    expect((await request('test', send)).statusCode).toBe(403)
  })
  it('does not activate channels whose integration is pending', async () => {
    for (const provider of ['waba', 'whatsmeow']) {
      expect((await request('save', { config: { ...config(), defaultProvider: provider } })).statusCode).toBe(409)
    }
  })
  it('migrates the legacy secret atomically out of public app configuration', async () => {
    m.documents.set(`${C.APP_CONFIG}/default`, { whapi: { apiToken: 'legacy-token', enabled: true } })
    expect((await request('save', { config: config() })).statusCode).toBe(200)
    expect(m.documents.get(`${C.APP_CONFIG}/default`).whapi.apiToken).toBeUndefined()
    expect(m.documents.get(`${C.WHATSAPP_CONFIG}/credentials`).whapiToken).toBe('private-test-token')
  })
  it('requires allowlisted numbers and ignores arbitrary destinations', async () => {
    expect((await request('test', { ...send, phone: '+60111111111' })).statusCode).toBe(403)
    expect(m.fetch).not.toHaveBeenCalled()
    expect((await request('test', { ...send, baseUrl: 'https://attacker.example' })).statusCode).toBe(200)
    expect(m.fetch.mock.calls[0][0]).toBe('https://gate.whapi.cloud/messages/text')
  })
  it('deduplicates submissions and detects changed payloads', async () => {
    const first = await request('test', send)
    expect(JSON.parse(first.body).status).toBe('accepted')
    expect((await request('test', send)).statusCode).toBe(200)
    expect(m.fetch).toHaveBeenCalledTimes(1)
    expect((await request('test', { ...send, text: 'Different' })).statusCode).toBe(409)
  })
  it('marks ambiguous provider failures as unknown and never resends that request', async () => {
    m.fetch.mockRejectedValue(new Error('timeout with secret'))
    const result = await request('test', send)
    expect(JSON.parse(result.body).status).toBe('unknown')
    expect(result.body).not.toContain('secret')
    await request('test', send)
    expect(m.fetch).toHaveBeenCalledTimes(1)
    const task = [...m.documents.entries()].find(([path]) => path.startsWith(C.WHATSAPP_TASKS))![1]
    expect(JSON.stringify(task)).not.toContain(send.text)
    expect(task.phone).toBe('***8000')
  })
  it('blocks business/manual sending when paused while allowing explicit tests', async () => {
    m.documents.set(`${C.WHATSAPP_CONFIG}/settings`, verifiedState({ ...config(), enabled: false }))
    expect((await request('manual', send)).statusCode).toBe(409)
    expect((await request('test', send)).statusCode).toBe(200)
  })
  it('rejects unverified or modified Whapi connections', async () => {
    const next = { ...config(), whapi: { channelId: 'different' } }
    expect((await request('save', { config: next })).statusCode).toBe(409)
    m.documents.set(`${C.WHATSAPP_CONFIG}/settings`, { config: config(), whapiVerified: false })
    expect((await request('test', send)).statusCode).toBe(409)
  })
  it('blocks non-consenting recipients and member sends to another account', async () => {
    m.documents.set(`${C.USERS}/recipient`, { profile: { phone: send.phone }, preferences: { whatsapp: false } })
    expect((await request('send', { ...send, userId: 'recipient' })).statusCode).toBe(409)
    m.documents.set(`${C.USERS}/operator`, { role: 'member' })
    expect((await request('send', { ...send, userId: 'recipient' })).statusCode).toBe(403)
    expect(m.fetch).not.toHaveBeenCalled()
  })
  it('does not mark QR/disconnected health responses as verified', async () => {
    m.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: { text: 'QR' } }) })
    expect((await request('health')).statusCode).toBe(503)
    expect(m.documents.get(`${C.WHATSAPP_CONFIG}/settings`).whapiVerified).toBe(false)
    m.fetch.mockResolvedValue({ ok: true, json: async () => ({ status: { text: 'AUTH' } }) })
    expect((await request('health')).statusCode).toBe(200)
  })
  it('invalidates verification when server credentials rotate', async () => {
    m.documents.set(`${C.WHATSAPP_CONFIG}/credentials`, { whapiToken: 'rotated-token' })
    expect(JSON.parse((await request('load')).body).whapiVerified).toBe(false)
    expect((await request('test', send)).statusCode).toBe(409)
  })
  it('rejects malformed configuration and request bodies', async () => {
    expect((await request('save', { config: { ...config(), whatsmeow: { baseUrl: 'invalid', phone: '' } } })).statusCode).toBe(400)
    expect((await invoke({ httpMethod: 'POST', headers: { authorization: 'Bearer token' }, body: 'null' })).statusCode).toBe(400)
  })
})
