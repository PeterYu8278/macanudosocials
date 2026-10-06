// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
const m = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn(), documents: new Map<string, any>(), failWrite: false, lostAcknowledgement: false }))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], cert: vi.fn(), initializeApp: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ createUser: m.create, deleteUser: m.remove }) }))
vi.mock('firebase-admin/firestore', () => {
  const snapshot = (path: string) => ({ id: path.split('/')[1], exists: m.documents.has(path), ref: reference(path), data: () => m.documents.get(path) })
  const reference = (path: string): any => ({ path, get: async () => snapshot(path) })
  const field = (data: any, key: string) => key.split('.').reduce((value, part) => value?.[part], data)
  const query = (name: string, key: string, value: unknown) => ({ limit: (count: number) => ({ get: async () => {
    const docs = [...m.documents].filter(([path, data]) => path.startsWith(`${name}/`) && field(data, key) === value).slice(0, count).map(([path]) => snapshot(path))
    return { docs, empty: !docs.length }
  } }) })
  return { Timestamp: { now: () => 'now' }, FieldValue: { arrayUnion: (value: unknown) => ['union', value], increment: (value: number) => ['increment', value] },
    getFirestore: () => ({ collection: (name: string) => ({ doc: (id = 'audit') => reference(`${name}/${id}`), where: (key: string, _op: string, value: unknown) => query(name, key, value) }),
      runTransaction: async (callback: any) => {
        const writes: Array<() => void> = []
        let profileWrite = false
        const result = await callback({ get: (ref: any) => ref.get(),
          set: (ref: any, data: any) => writes.push(() => m.documents.set(ref.path, data)),
          delete: (ref: any) => writes.push(() => m.documents.delete(ref.path)),
          create: (ref: any, data: any) => {
            if (ref.path.startsWith('users/')) { profileWrite = true; if (m.failWrite) throw new Error('write failed') }
            writes.push(() => m.documents.set(ref.path, data))
          },
          update: (ref: any, data: any) => writes.push(() => m.documents.set(ref.path, { ...m.documents.get(ref.path), ...data })),
        })
        writes.forEach(write => write())
        if (profileWrite && m.lostAcknowledgement) throw new Error('ack lost')
        return result
      } }) }
})
import { handler } from '../functions/register-member'
const invoke = handler as unknown as (event: any) => Promise<{ statusCode: number; body: string }>
const input = { email: 'MEMBER@example.com', password: 'password123', displayName: 'Member', phone: '0123456789' }
const request = (body: any = input) => invoke({ httpMethod: 'POST', headers: { 'x-nf-client-connection-ip': '127.0.0.1' }, body: JSON.stringify(body) })
describe('backend member registration', () => {
  beforeEach(() => {
    vi.resetAllMocks(); m.documents.clear(); m.failWrite = false; m.lostAcknowledgement = false
    m.create.mockResolvedValue({ uid: 'new-member' })
  })
  it('creates matching Auth and Firestore contacts, with no password in the member document', async () => {
    expect((await request()).statusCode).toBe(200)
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'member@example.com', phoneNumber: '+60123456789' }))
    const profile = m.documents.get('users/new-member')
    expect(profile).toMatchObject({ authUid: 'new-member', email: 'member@example.com', profile: { phone: '+60123456789' }, role: 'guest', membership: { points: 0 } })
    expect(JSON.stringify([...m.documents])).not.toContain(input.password)
  })
  it.each([
    ['email', 'member@example.com', 'email-in-use'],
    ['profile', { phone: '+60123456789' }, 'phone-in-use'],
    ['phone', '+60123456789', 'phone-in-use'],
  ])('rejects a legacy Firestore %s duplicate before creating Auth', async (key, value, code) => {
    m.documents.set('users/legacy', { [key as string]: value })
    expect(JSON.parse((await request()).body).code).toBe(code)
    expect(m.create).not.toHaveBeenCalled()
    expect(m.documents.has('users/new-member')).toBe(false)
  })
  it('rolls back Auth if the member write fails', async () => {
    m.failWrite = true
    expect((await request()).statusCode).toBe(503)
    expect(m.remove).toHaveBeenCalledWith('new-member')
    expect(m.documents.has('users/new-member')).toBe(false)
  })
  it('does not roll back a committed account after a lost acknowledgement', async () => {
    m.lostAcknowledgement = true
    expect((await request()).statusCode).toBe(200)
    expect(m.remove).not.toHaveBeenCalled()
  })
  it('rejects Auth conflicts without creating a Firestore member', async () => {
    m.create.mockRejectedValue({ code: 'auth/phone-number-already-exists' })
    expect(JSON.parse((await request()).body).code).toBe('phone-in-use')
    expect(m.documents.has('users/new-member')).toBe(false)
  })
  it('validates and links referrals in the same profile transaction', async () => {
    expect(JSON.parse((await request({ ...input, referralCode: 'REF123' })).body).code).toBe('invalid-referral-code')
    m.documents.set('users/referrer', { memberId: 'REF123' })
    expect((await request({ ...input, referralCode: 'REF123' })).statusCode).toBe(200)
    expect(m.documents.get('users/new-member').referral.referredByUserId).toBe('referrer')
    expect(m.documents.get('users/referrer')['referral.totalReferred']).toEqual(['increment', 1])
  })
  it('rate limits public registration attempts', async () => {
    const id = createHash('sha256').update('127.0.0.1').digest('hex')
    m.documents.set(`_registrationAttempts/${id}`, { count: 10, expiresAtMs: Date.now() + 100000 })
    expect((await request()).statusCode).toBe(429)
    expect(m.create).not.toHaveBeenCalled()
  })
})
