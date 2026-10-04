// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), getUser: vi.fn(), getEmail: vi.fn(), updateAuth: vi.fn(), commit: vi.fn(),
  documents: new Map<string, any>(), accounts: new Map<string, any>(),
}))
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn(), cert: vi.fn() }))
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify, getUser: mocks.getUser, getUserByEmail: mocks.getEmail, updateUser: mocks.updateAuth }) }))
vi.mock('firebase-admin/firestore', () => {
  const reference = (path: string) => ({
    path,
    get: async () => ({ data: () => structuredClone(mocks.documents.get(path)) }),
    update: async (data: any) => { mocks.documents.set(path, { ...mocks.documents.get(path), ...data }) },
  })
  return { Timestamp: { now: () => 'timestamp' }, getFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => reference(`${name}/${id}`),
      where: (field: string, _operator: string, value: string) => ({ limit: (count: number) => ({ get: async () => ({
        docs: [...mocks.documents].filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value)
          .slice(0, count).map(([path]) => ({ id: path.split('/')[1] })),
      }) }) }),
    }),
    runTransaction: async (callback: any) => callback({
      get: (ref: any) => ref.get(),
      set: (ref: any, data: any) => mocks.documents.set(ref.path, structuredClone(data)),
      delete: (ref: any) => mocks.documents.delete(ref.path),
    }),
    batch: () => {
      const operations: Array<() => void> = []
      return {
        update: (ref: any, data: any) => operations.push(() => mocks.documents.set(ref.path, { ...mocks.documents.get(ref.path), ...structuredClone(data) })),
        set: (ref: any, data: any) => operations.push(() => mocks.documents.set(ref.path, { ...mocks.documents.get(ref.path), ...structuredClone(data) })),
        commit: async () => { await mocks.commit(); operations.forEach(operation => operation()) },
      }
    },
  }) }
})
import { handler } from '../functions/update-member-email'
const invoke = handler as unknown as (event: unknown) => Promise<{ statusCode: number; body: string }>
const save = (mode = 'prepare', email = 'New@Example.com ', userId = 'member') => invoke({
  httpMethod: 'POST', headers: { authorization: 'Bearer token' }, body: JSON.stringify({ userId, mode, email }),
})
const profile = () => mocks.documents.get('users/member')
const operator = (role = 'admin') => {
  mocks.documents.set('users/operator', { role })
  mocks.verify.mockResolvedValue({ uid: 'operator', auth_time: Date.now() / 1000, firebase: { sign_in_provider: 'google.com' } })
}

describe('member email changes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.documents.clear()
    mocks.accounts.clear()
    mocks.documents.set('users/member', { email: 'old@example.com', role: 'member' })
    mocks.accounts.set('member', { uid: 'member', email: 'old@example.com', emailVerified: true })
    mocks.verify.mockResolvedValue({ uid: 'member', auth_time: Date.now() / 1000, firebase: { sign_in_provider: 'password' } })
    mocks.getUser.mockImplementation(async uid => {
      const account = mocks.accounts.get(uid)
      if (!account) throw { code: 'auth/user-not-found' }
      return { ...account }
    })
    mocks.getEmail.mockImplementation(async email => {
      const account = [...mocks.accounts.values()].find(account => account.email === email)
      if (!account) throw { code: 'auth/user-not-found' }
      return { ...account }
    })
    mocks.updateAuth.mockImplementation(async (uid, data) => {
      const account = { ...mocks.accounts.get(uid), ...data }
      mocks.accounts.set(uid, account)
      return account
    })
    mocks.commit.mockResolvedValue(undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('persists the UID and pending email before sending verification, without changing either login email', async () => {
    expect((await save()).statusCode).toBe(200)
    expect(profile()).toMatchObject({ authUid: 'member', email: 'old@example.com', emailChange: { email: 'new@example.com', status: 'awaiting-verification' } })
    expect(mocks.updateAuth).not.toHaveBeenCalled()
    expect(mocks.accounts.get('member').email).toBe('old@example.com')
    expect(mocks.documents.get(`_memberEmailChanges/${profile().emailChange.id}`)).toMatchObject({ userId: 'member', previousEmail: 'old@example.com', requestedBy: 'member' })
    expect(mocks.documents.has('_memberEmailLocks/member')).toBe(false)
  })

  it('lets an admin request member confirmation without changing Auth or Firestore email', async () => {
    operator()
    expect((await save('request')).statusCode).toBe(200)
    expect(profile()).toMatchObject({ email: 'old@example.com', emailChange: { status: 'requested', requestedBy: 'operator' } })
    expect(mocks.updateAuth).not.toHaveBeenCalled()
  })

  it('requires the member, not their administrator, to prepare the confirmation email', async () => {
    operator()
    expect((await save()).statusCode).toBe(403)
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it.each(['expired', 'custom', 'missing'])('rejects mutations without recent password or Google verification (%s)', async kind => {
    mocks.verify.mockResolvedValue({ uid: 'member', auth_time: kind === 'missing' ? undefined : Date.now() / 1000 - (kind === 'expired' ? 600 : 0), firebase: { sign_in_provider: kind === 'custom' ? 'custom' : 'password' } })
    expect((await save()).statusCode).toBe(401)
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('denies administrator correction to an ordinary member, even for themselves', async () => {
    expect((await save('correct')).statusCode).toBe(403)
    expect(mocks.updateAuth).not.toHaveBeenCalled()
  })

  it.each(['admin', 'superAdmin', 'developer'])('protects equal or higher %s roles from admin correction', async role => {
    operator()
    mocks.documents.set('users/member', { email: 'old@example.com', role })
    expect((await save('correct')).statusCode).toBe(403)
    expect(mocks.updateAuth).not.toHaveBeenCalled()
  })

  it('corrects the target Auth account and marks the new email unverified', async () => {
    operator()
    expect((await save('correct')).statusCode).toBe(200)
    expect(mocks.updateAuth).toHaveBeenCalledWith('member', { email: 'new@example.com', emailVerified: false })
    expect(profile()).toMatchObject({ email: 'new@example.com', emailAuth: { verified: false }, emailChange: { method: 'admin-correction', status: 'completed' } })
    expect(mocks.commit.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateAuth.mock.invocationCallOrder[0])
    expect(mocks.documents.get(`_memberEmailChanges/${profile().emailChange.id}`)).toMatchObject({ requestedBy: 'operator', verified: false })
  })

  it.each(['firestore', 'auth'])('rejects an email held by another member (%s)', async kind => {
    operator()
    if (kind === 'firestore') mocks.documents.set('users/other', { email: 'new@example.com' })
    else mocks.accounts.set('other', { uid: 'other', email: 'new@example.com' })
    expect((await save('correct')).statusCode).toBe(409)
    expect(mocks.updateAuth).not.toHaveBeenCalled()
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('does not update Auth when the pre-change mapping/audit write fails', async () => {
    operator()
    mocks.commit.mockRejectedValueOnce({ code: 8 })
    expect(JSON.parse((await save('correct')).body).code).toBe('service-unavailable')
    expect(mocks.updateAuth).not.toHaveBeenCalled()
  })

  it('repairs an Auth success / Firestore failure using the same audit operation and without changing Auth again', async () => {
    operator()
    mocks.commit.mockResolvedValueOnce(undefined).mockRejectedValueOnce({ code: 8 })
    expect(JSON.parse((await save('correct')).body).code).toBe('profile-sync-failed')
    expect(profile()).toMatchObject({ authUid: 'member', email: 'old@example.com', emailChange: { status: 'sync-pending' } })
    const id = profile().emailChange.id
    expect((await save('correct')).statusCode).toBe(200)
    expect(profile().emailChange.id).toBe(id)
    expect(mocks.updateAuth).toHaveBeenCalledTimes(1)
    expect(profile().email).toBe('new@example.com')
  })

  it('resolves a legacy document after its Auth email changed using the persisted UID', async () => {
    operator()
    const member = profile()
    mocks.documents.delete('users/member')
    mocks.documents.set('users/legacy', member)
    mocks.commit.mockResolvedValueOnce(undefined).mockRejectedValueOnce({ code: 8 })
    expect((await save('correct', 'new@example.com', 'legacy')).statusCode).toBe(503)
    expect(mocks.documents.get('users/legacy').authUid).toBe('member')
    mocks.getEmail.mockClear()
    expect((await save('correct', 'new@example.com', 'legacy')).statusCode).toBe(200)
    expect(mocks.getUser).toHaveBeenCalledWith('member')
    expect(mocks.getEmail).not.toHaveBeenCalledWith('old@example.com')
  })

  it('does not infer a different account from email if the stored UID is missing', async () => {
    profile().authUid = 'deleted-account'
    expect(JSON.parse((await save()).body).code).toBe('auth-account-missing')
    expect(mocks.getEmail).not.toHaveBeenCalled()
  })

  it('keeps both emails unchanged until the new mailbox is confirmed', async () => {
    await save()
    expect(JSON.parse((await save('sync')).body).code).toBe('verification-pending')
    mocks.accounts.get('member').email = 'new@example.com'
    mocks.accounts.get('member').emailVerified = false
    expect(JSON.parse((await save('sync')).body).code).toBe('verification-pending')
    expect(profile().email).toBe('old@example.com')
  })

  it('synchronizes the verified Auth email, not a caller-provided email, without requiring another reauthentication', async () => {
    await save()
    mocks.accounts.set('member', { uid: 'member', email: 'new@example.com', emailVerified: true })
    mocks.verify.mockResolvedValue({ uid: 'member', auth_time: 0, firebase: { sign_in_provider: 'custom' } })
    expect((await save('sync', 'attacker@example.com')).statusCode).toBe(200)
    expect(profile()).toMatchObject({ email: 'new@example.com', emailAuth: { verified: true }, emailChange: { status: 'completed' } })
    expect(mocks.updateAuth).not.toHaveBeenCalled()
  })

  it('does not let an admin use the self-service sync endpoint for someone else', async () => {
    operator()
    expect((await save('sync')).statusCode).toBe(403)
  })

  it('rejects competing backend requests while a lease is active', async () => {
    mocks.documents.set('_memberEmailLocks/member', { id: 'other-request', expiresAtMs: Date.now() + 60000 })
    expect(JSON.parse((await save()).body).code).toBe('change-busy')
    expect(mocks.documents.get('_memberEmailLocks/member').id).toBe('other-request')
  })

  it('allows cancel before verification but requires sync after Auth already changed', async () => {
    await save('request')
    expect((await save('cancel')).statusCode).toBe(200)
    expect(profile().emailChange.status).toBe('cancelled')
    await save()
    expect(JSON.parse((await save('cancel')).body).code).toBe('verification-pending')
    mocks.accounts.get('member').email = 'new@example.com'
    expect(JSON.parse((await save('cancel')).body).code).toBe('sync-required')
  })

  it('does not silently create missing Auth accounts', async () => {
    mocks.accounts.clear()
    expect(JSON.parse((await save()).body).code).toBe('auth-account-missing')
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('rejects malformed inputs and missing authorization', async () => {
    expect((await save('prepare', 'bad')).statusCode).toBe(400)
    expect((await save('prepare', 'new@example.com', 'users/member')).statusCode).toBe(400)
    expect((await save('unknown')).statusCode).toBe(400)
    expect((await invoke({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ userId: 'member', mode: 'sync' }) })).statusCode).toBe(401)
    expect(mocks.updateAuth).not.toHaveBeenCalled()
  })
})
