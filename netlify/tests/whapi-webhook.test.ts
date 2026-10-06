// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
const m = vi.hoisted(() => ({ documents: new Map<string, any>(), writes: 0, fail: false }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], cert: vi.fn(), initializeApp: vi.fn() }))
vi.mock('firebase-admin/firestore', () => {
  const snapshot = (path: string) => ({ id: path.split('/').at(-1), exists: m.documents.has(path), data: () => m.documents.get(path) })
  const set = (path: string, value: any, options: any) => {
    m.writes++
    m.documents.set(path, options?.merge ? { ...m.documents.get(path), ...value } : value)
  }
  const db = { collection: (name: string) => ({
    doc: (id: string) => ({ path: `${name}/${id}`, get: async () => {
      if (m.fail) throw new Error('database unavailable')
      return snapshot(`${name}/${id}`)
    }, set: async (value: any, options: any) => set(`${name}/${id}`, value, options) }),
    where: (field: string, _op: string, value: any) => ({ limit: (count: number) => ({ get: async () => ({
      docs: [...m.documents.entries()].filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value).slice(0, count).map(([path]) => snapshot(path)),
    }) }) }),
  }), runTransaction: async (callback: any) => callback({ get: async (ref: any) => snapshot(ref.path),
    set: (ref: any, value: any, options: any) => set(ref.path, value, options),
    update: (ref: any, value: any) => set(ref.path, value, { merge: true }) }) }
  return { initializeFirestore: () => db, Timestamp: { now: () => new Date(), fromMillis: (value: number) => new Date(value) } }
})
import { initializeFirestore } from 'firebase-admin/firestore'
import webHandler from '../functions/whapi-webhook'
import { attachSubmission, receiptId } from '../functions/_shared/whapiReceipts'
const secret = 'test-webhook-secret-at-least-32-characters'
const time = Math.floor(Date.now() / 1000) - 60
const payload = (status = 'delivered', timestamp = time) => ({ channel_id: 'channel-one',
  event: { type: 'statuses', event: 'post' }, statuses: [{ id: 'provider-message', status, timestamp: String(timestamp) }] })
const request = (body: unknown = payload(), token = secret) => webHandler(new Request('https://example.com/.netlify/functions/whapi-webhook', {
  method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
}))
const task = () => m.documents.get(`${C.WHATSAPP_TASKS}/task-one`)

describe('Whapi delivery callbacks', () => {
  beforeEach(() => {
    m.documents.clear(); m.writes = 0; m.fail = false
    vi.stubEnv('WHAPI_WEBHOOK_SECRET', secret)
    m.documents.set(`${C.WHATSAPP_CONFIG}/settings`, { config: { whapi: { channelId: 'channel-one' } } })
    m.documents.set(`${C.WHATSAPP_TASKS}/task-one`, { provider: 'whapi', channelId: 'channel-one', messageId: 'provider-message', status: 'accepted' })
  })
  afterEach(() => vi.unstubAllEnvs())
  it('fails closed for missing/short secrets or invalid authentication', async () => {
    expect((await request(payload(), 'wrong')).status).toBe(401)
    vi.stubEnv('WHAPI_WEBHOOK_SECRET', '')
    expect((await request()).status).toBe(503)
    expect(m.writes).toBe(0)
  })
  it('rejects a different channel and non-POST requests', async () => {
    expect((await request({ ...payload(), channel_id: 'another-channel' })).status).toBe(403)
    expect((await webHandler(new Request('https://example.com/webhook'))).status).toBe(405)
    expect(m.writes).toBe(0)
  })
  it('accepts official event.post and OpenAPI method.put formats', async () => {
    expect((await request()).status).toBe(200)
    expect(task().status).toBe('delivered')
    expect((await request({ ...payload('read', time + 1), event: { type: 'statuses', method: 'put' } })).status).toBe(200)
    expect(task().status).toBe('read')
  })
  it('is idempotent and never regresses delivered/read to older statuses or failure', async () => {
    await request(payload('read', time + 3))
    await request(payload('read', time + 3))
    await request(payload('sent', time + 4))
    await request(payload('delivered', time + 2))
    await request(payload('failed', time + 5))
    expect(task().status).toBe('read')
    expect(task().statusAtMs).toBe((time + 3) * 1000)
    expect([...m.documents.keys()].filter(path => path.startsWith(`${C.WHATSAPP_RECEIPTS}/`))).toHaveLength(1)
  })
  it('allows delivery evidence to recover from failure but ignores stale sent events', async () => {
    await request(payload('failed', time + 3))
    await request(payload('sent', time))
    expect(task().status).toBe('failed')
    await request(payload('delivered', time + 2))
    expect(task().status).toBe('delivered')
  })
  it('reconciles a callback that arrives before the send response without overwriting it', async () => {
    m.documents.set(`${C.WHATSAPP_TASKS}/task-one`, { provider: 'whapi', status: 'submitting' })
    await request(payload('read'))
    expect(task().status).toBe('submitting')
    const db = initializeFirestore({} as any, { preferRest: true })
    expect(await attachSubmission(db, 'task-one', 'channel-one', { status: 'accepted', messageId: 'provider-message' })).toBe('read')
    expect(task().status).toBe('read')
    expect(m.documents.get(`${C.WHATSAPP_RECEIPTS}/${receiptId('channel-one', 'provider-message')}`).taskId).toBe('task-one')
  })
  it('does not update manual or different-channel tasks, and never stores message text or recipients', async () => {
    m.documents.set(`${C.WHATSAPP_TASKS}/task-one`, { provider: 'manual', messageId: 'provider-message', status: 'opened' })
    const body = payload()
    Object.assign(body.statuses[0], { recipient_id: '60168008000@s.whatsapp.net', text: 'private content' })
    await request(body)
    expect(task().status).toBe('opened')
    const receipts = JSON.stringify([...m.documents.entries()].filter(([path]) => path.startsWith(C.WHATSAPP_RECEIPTS)))
    expect(receipts).not.toContain('60168008000')
    expect(receipts).not.toContain('private content')
    m.documents.set(`${C.WHATSAPP_TASKS}/task-one`, { provider: 'whapi', channelId: 'other', messageId: 'provider-message', status: 'accepted' })
    await request(payload('read'))
    expect(task().status).toBe('accepted')
  })
  it('updates legacy records with a stored message ID', async () => {
    delete task().channelId
    await request()
    expect(task().status).toBe('delivered')
  })
  it('ignores unrelated callbacks and pending/deleted statuses', async () => {
    await request({ ...payload(), event: { type: 'messages', event: 'post' }, messages: [{ text: { body: 'private' } }] })
    await request(payload('pending'))
    await request(payload('deleted'))
    expect(task().status).toBe('accepted')
  })
  it('validates the whole batch before mutation and rejects oversized/future/malformed payloads', async () => {
    expect((await request({ ...payload(), statuses: [...payload().statuses, { id: '' }] })).status).toBe(400)
    expect((await request(payload('read', time + 10000))).status).toBe(400)
    expect((await request(null)).status).toBe(400)
    expect((await request({ ...payload(), padding: 'x'.repeat(65536) })).status).toBe(400)
    expect(m.writes).toBe(0)
  })
  it('returns a retryable failure without leaking backend details', async () => {
    m.fail = true
    const response = await request()
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('database')
  })
})
