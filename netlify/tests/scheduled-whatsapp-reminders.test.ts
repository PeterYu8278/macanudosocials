// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
import { defaultWhatsAppSettings } from '../../src/types/whatsapp'
const mocks = vi.hoisted(() => ({ load: vi.fn(), submit: vi.fn(), attach: vi.fn() }))
vi.mock('../functions/_shared/whatsapp', () => ({ loadWhatsApp: mocks.load, submitWhapi: mocks.submit }))
vi.mock('../functions/_shared/whapiReceipts', () => ({ attachSubmission: mocks.attach }))
import { runScheduledWhatsApp } from '../functions/_shared/scheduledWhatsApp'

const now = new Date('2026-10-06T04:00:00Z')
const documents = new Map<string, any>()
const value = (data: any, path: string) => path.split('.').reduce((item, key) => item?.[key], data)
const millis = (item: any) => item?.toMillis?.() ?? (item instanceof Date ? item.getTime() : item)
const snapshot = (path: string) => ({ exists: documents.has(path), data: () => documents.get(path) })
const db = {
  collection: (name: string) => {
    const query = (filters: any[] = []): any => ({
      doc: (id: string) => ({ path: `${name}/${id}` }),
      where: (field: string, op: string, expected: any) => query([...filters, [field, op, expected]]),
      get: async () => ({ docs: [...documents.entries()].filter(([path, data]) =>
        path.startsWith(`${name}/`) && filters.every(([field, op, expected]) =>
          op === '>=' ? millis(value(data, field)) >= millis(expected) : millis(value(data, field)) < millis(expected)),
      ).map(([path, data]) => ({ id: path.split('/')[1], data: () => data })) }),
    })
    return query()
  },
  runTransaction: async (callback: any) => callback({
    get: async (ref: any) => snapshot(ref.path),
    create: (ref: any, data: any) => { if (documents.has(ref.path)) throw new Error('duplicate'); documents.set(ref.path, data) },
  }),
} as unknown as Firestore
const user = (id: string, preferences = { whatsapp: true }) => documents.set(`${C.USERS}/${id}`, {
  displayName: id, profile: { phone: '0168008000' }, preferences, status: 'active',
})
const event = (overrides = {}) => documents.set(`${C.EVENTS}/event`, {
  title: 'Cigar Gathering', status: 'published', schedule: { startDate: new Date('2026-10-07T11:00:00Z') },
  participants: { registered: ['member'] }, location: { name: 'KK Lounge' }, ...overrides,
})
const fee = (id: string, days: number, overrides = {}) => documents.set(`${C.MEMBERSHIP_FEE_RECORDS}/${id}`, {
  userId: 'member', status: 'pending', dueDate: new Date(now.getTime() + days * 86400000), ...overrides,
})
describe('scheduled WhatsApp business reminders', () => {
  beforeEach(() => {
    vi.resetAllMocks(); documents.clear()
    vi.useFakeTimers(); vi.setSystemTime(now)
    mocks.load.mockResolvedValue({ config: { ...defaultWhatsAppSettings, enabled: true,
      defaultProvider: 'whapi', features: { eventReminder: true, vipExpiry: true, passwordReset: false } },
    token: 'test-token', verified: true })
    mocks.submit.mockResolvedValue({ status: 'accepted', messageId: 'message' })
    mocks.attach.mockResolvedValue('accepted')
    user('member')
  })
  afterEach(() => vi.useRealTimers())
  it('only reminds registered members the day before and deduplicates later runs', async () => {
    user('unregistered'); event()
    expect((await runScheduledWhatsApp(db, now)).accepted).toBe(1)
    expect(mocks.submit.mock.calls[0][2]).toContain('7 Oct 2026')
    expect(mocks.submit.mock.calls[0][2]).toContain('KK Lounge')
    expect((await runScheduledWhatsApp(db, now)).duplicate).toBe(1)
    expect(mocks.submit).toHaveBeenCalledTimes(1)
    const task = [...documents.entries()].find(([path]) => path.startsWith(`${C.WHATSAPP_TASKS}/`))![1]
    expect(task).toMatchObject({ source: 'scheduled', userId: 'member', phone: '***8000' })
    expect(JSON.stringify(task)).not.toContain('Cigar Gathering')
  })
  it('sends separate renewal milestones but excludes paid records and other days', async () => {
    fee('seven', 7); fee('three', 3); fee('one', 1); fee('two', 2); fee('paid', 1, { status: 'paid' })
    expect((await runScheduledWhatsApp(db, now)).accepted).toBe(3)
    expect((await runScheduledWhatsApp(db, now)).duplicate).toBe(3)
    expect(mocks.submit).toHaveBeenCalledTimes(3)
  })
  it.each(['draft', 'cancelled', 'completed'])('excludes %s events', async status => {
    event({ status }); await runScheduledWhatsApp(db, now)
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('requires consent and an active valid recipient', async () => {
    event(); user('member', { whatsapp: false })
    expect((await runScheduledWhatsApp(db, now)).skipped).toBe(1)
    user('member'); documents.get(`${C.USERS}/member`).status = 'inactive'
    await runScheduledWhatsApp(db, now)
    user('member'); documents.get(`${C.USERS}/member`).profile.phone = 'invalid'
    await runScheduledWhatsApp(db, now)
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it.each([{ enabled: false }, { defaultProvider: 'manual' }, { verified: false }])('respects channel gates %j', async gate => {
    event()
    const loaded = await mocks.load()
    mocks.load.mockResolvedValue({ ...loaded, ...(gate.verified === false ? { verified: false } : {}), config: { ...loaded.config, ...gate } })
    await runScheduledWhatsApp(db, now)
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('respects both business feature switches', async () => {
    event(); fee('one', 1)
    const loaded = await mocks.load()
    loaded.config.features = { eventReminder: false, vipExpiry: false, passwordReset: false }
    await runScheduledWhatsApp(db, now)
    expect(mocks.submit).not.toHaveBeenCalled()
  })
  it('records ambiguous submissions without automatic resend', async () => {
    event(); mocks.submit.mockRejectedValue(new Error('timeout'))
    expect((await runScheduledWhatsApp(db, now)).unknown).toBe(1)
    expect(mocks.attach).toHaveBeenCalledWith(db, expect.any(String), '', { status: 'unknown', messageId: '' })
    await runScheduledWhatsApp(db, now)
    expect(mocks.submit).toHaveBeenCalledTimes(1)
  })
  it('continues other recipients after a rejected provider submission', async () => {
    event(); fee('one', 1)
    mocks.submit.mockResolvedValueOnce({ status: 'failed', messageId: '' })
    expect(await runScheduledWhatsApp(db, now)).toMatchObject({ failed: 1, accepted: 1 })
  })
  it('defers remaining work before the function timeout and resumes on the next run', async () => {
    event(); fee('one', 1)
    mocks.submit.mockImplementationOnce(async () => { vi.setSystemTime(now.getTime() + 13000); return { status: 'accepted', messageId: 'first' } })
    expect(await runScheduledWhatsApp(db, now)).toMatchObject({ accepted: 1, deferred: true })
    expect(await runScheduledWhatsApp(db, now)).toMatchObject({ accepted: 1, duplicate: 1 })
    expect(mocks.submit).toHaveBeenCalledTimes(2)
  })
})
