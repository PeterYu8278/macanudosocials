// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
import { defaultWhatsAppSettings } from '../../src/types/whatsapp'
import { assertMeowBinding, gatewayRequest, loadMeow, manageMeow, registeredGateways, submitMeow, validGatewayStatus, verifyGatewayCallback } from '../functions/_shared/whatsmeow'
import { attachSubmission, receiveReceipt } from '../functions/_shared/whapiReceipts'

const docs = new Map<string, any>()
const fetchMock = vi.fn()
const path = (id: string) => `${C.WHATSAPP_CONFIG}/${id}`
const digest = (v: string) => createHash('sha256').update(v).digest('hex')
const merge = (old: any, next: any): any => Object.fromEntries(Object.entries({ ...old, ...next }).map(([key, value]) => [key,
  value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype ? merge(old?.[key], value) : value]))
const snapshot = (p: string) => ({ exists: docs.has(p), data: () => docs.get(p) })
let sequence = 0
const ref = (p: string): any => ({ path: p, id: p.split('/').pop(), get: async () => snapshot(p),
  set: async (value: any, options: any) => docs.set(p, options?.merge ? merge(docs.get(p), value) : value) })
const db = {
  collection: (name: string) => ({ doc: (id = `auto-${++sequence}`) => ref(`${name}/${id}`),
    where: (field: string, _op: string, value: string) => ({ limit: () => ({ get: async () => ({ docs: [...docs.entries()].filter(([p, data]) => p.startsWith(`${name}/`) && data[field] === value).map(([p]) => ({ ...ref(p), data: () => docs.get(p) })) }) }) }) }),
  runTransaction: async (fn: any) => {
    const mutations: Array<() => void> = []
    const write = (r: any, value: any, options?: any) => mutations.push(() => docs.set(r.path, options?.merge ? merge(docs.get(r.path), value) : value))
    const result = await fn({ get: async (r: any) => { if (mutations.length) throw new Error('read-after-write'); return snapshot(r.path) },
      set: write, update: (r: any, value: any) => write(r, value, { merge: true }), create: write,
      delete: (r: any) => mutations.push(() => docs.delete(r.path)) })
    mutations.forEach(apply => apply())
    return result
  },
} as unknown as Firestore
const health = (overrides = {}) => new Response(JSON.stringify({ sessionId: 'device-1', account: '+60123456789', status: 'connected', ...overrides }))
const call = (action: string, input = {}, owner = 'manager') => manageMeow(db, owner, { action, ...input })
const candidatePath = () => path(`whatsmeow-candidate-${digest('manager')}`)
async function stage() { await call('meow-stage', { gatewayId: 'pilot', token: 'test-gateway-token-'.repeat(3) }) }
async function activate() { await stage(); await call('meow-activate', { confirm: true, account: '+60123456789' }); return loadMeow(db) }

describe('Whatsmeow trust boundaries', () => {
  beforeEach(() => {
    docs.clear(); fetchMock.mockReset(); sequence = 0
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('WHATSAPP_CREDENTIAL_ENCRYPTION_KEY', Buffer.alloc(32, 8).toString('base64'))
    vi.stubEnv('WHATSMEOW_GATEWAYS', JSON.stringify({ pilot: 'https://gateway.example.com' }))
    docs.set(path('settings'), { config: { ...defaultWhatsAppSettings, defaultProvider: 'whapi', enabled: false } })
    fetchMock.mockImplementation(async () => health())
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it('only accepts registered HTTPS origins without paths, userinfo or query strings', async () => {
    vi.stubEnv('WHATSMEOW_GATEWAYS', JSON.stringify({ good: 'https://example.com', bad: 'http://localhost', path: 'https://example.com/api', auth: 'https://secret@example.com', query: 'https://example.com/?token=x' }))
    expect(Object.keys(registeredGateways())).toEqual(['good'])
    await expect(gatewayRequest('https://attacker.example', 'token', '/v1/status')).rejects.toThrow('gateway-not-registered')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('rejects missing session IDs and malformed account/status responses', () => {
    expect(() => validGatewayStatus({ status: 'connected', account: '+60123456789' })).toThrow()
    expect(() => validGatewayStatus({ sessionId: 'one', status: 'connected', account: '123@lid' })).toThrow()
    expect(() => validGatewayStatus({ sessionId: 'one', status: 'AUTH' })).toThrow()
  })
  it('bounds response size and forbids redirects', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(16001)))
    await expect(gatewayRequest('https://gateway.example.com', 'secret', '/v1/status')).rejects.toThrow('gateway-invalid-response')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error', cache: 'no-store' })
  })
  it('keeps credentials encrypted and does not change the active provider while staging', async () => {
    const result = await call('meow-stage', { gatewayId: 'pilot', token: 'private-gateway-token'.repeat(3) })
    expect(result).toEqual({ staged: true })
    expect(JSON.stringify([...docs.values()])).not.toContain('private-gateway-token')
    expect(docs.get(path('settings')).config.defaultProvider).toBe('whapi')
    await expect(loadMeow(db)).rejects.toThrow('verification-required')
  })
  it('requires explicit confirmation, connected status, and full number matching', async () => {
    await stage()
    await expect(call('meow-activate', { account: '+60123456789' })).rejects.toThrow('account-mismatch')
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 2000)
    await expect(call('meow-activate', { confirm: true, account: '+60999999999' })).rejects.toThrow('account-mismatch')
    vi.setSystemTime(Date.now() + 2000); fetchMock.mockImplementation(async () => health({ status: 'disconnected' }))
    await expect(call('meow-activate', { confirm: true, account: '+60123456789' })).rejects.toThrow('account-mismatch')
  })
  it('preserves switches and activates atomically with an audit record', async () => {
    const active = await activate()
    expect(active.sessionId).toBe('device-1')
    expect(docs.get(path('settings')).config).toMatchObject({ defaultProvider: 'whatsmeow', enabled: false, features: defaultWhatsAppSettings.features })
    expect(docs.has(candidatePath())).toBe(false)
    expect([...docs.keys()].some(p => p.startsWith(`${C.AUDIT_LOGS}/`))).toBe(true)
  })
  it('rejects another manager and expired candidates', async () => {
    await stage()
    await expect(call('meow-status', {}, 'other')).rejects.toThrow('connection-expired')
    docs.get(candidatePath()).expiresAtMs = Date.now() - 1
    await expect(call('meow-activate', { confirm: true, account: '+60123456789' })).rejects.toThrow('connection-expired')
  })
  it('rejects stale configuration and changed device generations during activation', async () => {
    await stage()
    docs.get(path('settings')).config.enabled = true
    await expect(call('meow-activate', { confirm: true, account: '+60123456789' })).rejects.toThrow('connection-changed')
    docs.get(candidatePath()).lastActionMs = 0
    fetchMock.mockImplementation(async () => health({ sessionId: 'other-generation' }))
    await expect(call('meow-activate', { confirm: true, account: '+60123456789' })).rejects.toThrow('connection-changed')
  })
  it('invalidates work on activation changes and does not fall back after encryption/registry failure', async () => {
    const active = await activate()
    await db.runTransaction(tx => assertMeowBinding(db, tx, active))
    docs.get(path('whatsmeow-active')).version = 'replacement'
    await expect(db.runTransaction(tx => assertMeowBinding(db, tx, active))).rejects.toThrow('connection-changed')
    vi.stubEnv('WHATSAPP_CREDENTIAL_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'))
    await expect(loadMeow(db)).rejects.toThrow('credentials-invalid')
    vi.stubEnv('WHATSMEOW_GATEWAYS', '{}')
    await expect(loadMeow(db)).rejects.toThrow('gateway-not-registered')
  })
  it('masks account and clamps QR lifetime without persisting QR', async () => {
    await stage()
    fetchMock.mockImplementation(async () => health({ status: 'qr', qr: 'private-qr', qrExpiresAtMs: Date.now() + 60000 }))
    const result = await call('meow-status')
    expect(result).toMatchObject({ account: '***6789', qr: 'private-qr' })
    expect(result.qrExpiresAtMs! - Date.now()).toBeLessThanOrEqual(20000)
    expect(JSON.stringify([...docs.values()])).not.toContain('private-qr')
    await expect(call('meow-status')).rejects.toThrow('connection-busy')
  })
  it('submits a stable session-bound payload and validates acknowledgement IDs', async () => {
    const active = await activate()
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'queued', messageId: 'provider-id' })))
    expect(await submitMeow(active, 'request-123', '+60123456789', 'hello', 123456)).toEqual({ status: 'accepted', messageId: 'provider-id' })
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toMatchObject({ sessionId: active.sessionId, account: active.account, requestId: 'request-123', expiresAtMs: 123456 })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'queued', messageId: '' })))
    await expect(submitMeow(active, 'request-123', '+60123456789', 'hello', 123456)).rejects.toThrow('gateway-invalid-response')
  })
  it('authenticates exact raw body, timestamp and event ID', () => {
    const key = 'k'.repeat(32), body = '{"status":"sent"}', stamp = String(Math.floor(Date.now() / 1000)), id = 'a'.repeat(64)
    const headers = { 'x-gateway-timestamp': stamp, 'x-gateway-event': id, 'x-gateway-signature': createHmac('sha256', key).update(`${stamp}.${id}.${body}`).digest('hex') }
    expect(verifyGatewayCallback(headers, body, key)).toBe(true)
    expect(verifyGatewayCallback(headers, `${body} `, key)).toBe(false)
    expect(verifyGatewayCallback(headers, body, key, Date.now() + 301000)).toBe(false)
    expect(verifyGatewayCallback({ ...headers, 'x-gateway-event': 'b'.repeat(64) }, body, key)).toBe(false)
    expect(verifyGatewayCallback(headers, body, 'short')).toBe(false)
  })
  it('keeps provider/session receipt namespaces isolated and never regresses read status', async () => {
    const task = `${C.WHATSAPP_TASKS}/task`
    docs.set(task, { provider: 'whatsmeow', channelId: 'whatsmeow:pilot:one', messageId: 'shared', status: 'unknown' })
    await receiveReceipt(db, 'old-channel', 'shared', { status: 'read', statusAtMs: 1000 })
    expect(docs.get(task).status).toBe('unknown')
    await receiveReceipt(db, 'whatsmeow:pilot:other', 'shared', { status: 'read', statusAtMs: 1000 }, false, 'whatsmeow')
    expect(docs.get(task).status).toBe('unknown')
    await receiveReceipt(db, 'whatsmeow:pilot:one', 'shared', { status: 'read', statusAtMs: 1000 }, false, 'whatsmeow')
    expect(docs.get(task).status).toBe('read')
    await attachSubmission(db, 'task', 'whatsmeow:pilot:one', { status: 'unknown', messageId: '' })
    expect(docs.get(task)).toMatchObject({ status: 'read', messageId: 'shared' })
    await expect(attachSubmission(db, 'task', 'whatsmeow:pilot:one', { status: 'sent', messageId: 'different' })).rejects.toThrow('submission-message-mismatch')
  })
})
