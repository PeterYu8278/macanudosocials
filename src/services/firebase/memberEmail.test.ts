import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ token: vi.fn(), fetch: vi.fn(), verifyEmail: vi.fn(), verifyCurrent: vi.fn(), auth: { currentUser: null as any } }))
vi.mock('../../config/firebase', () => ({ auth: mocks.auth }))
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('firebase/auth', () => ({ verifyBeforeUpdateEmail: mocks.verifyEmail, sendEmailVerification: mocks.verifyCurrent }))
import { requestMemberEmailVerification, updateMemberEmail, verifyCurrentMemberEmail } from './memberEmail'

describe('member email service', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.currentUser = { getIdToken: mocks.token }
    mocks.token.mockResolvedValue('fresh-token')
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', mocks.fetch)
  })
  afterEach(() => vi.unstubAllGlobals())
  it('sends the target ID, normalized email and mode with a fresh token, not a password', async () => {
    await updateMemberEmail('target', 'correct', ' New@Example.com ')
    expect(mocks.fetch.mock.calls[0][0]).toBe('/.netlify/functions/update-member-email')
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ userId: 'target', mode: 'correct', email: 'new@example.com' })
    expect(mocks.token).toHaveBeenCalledWith(true)
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer fresh-token')
  })
  it('persists the backend mapping before sending a Firebase verification link', async () => {
    await requestMemberEmailVerification('target', ' New@Example.com ')
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).mode).toBe('prepare')
    expect(mocks.verifyEmail).toHaveBeenCalledWith(mocks.auth.currentUser, 'new@example.com', { url: `${window.location.origin}/profile?emailSync=1` })
    expect(mocks.fetch.mock.invocationCallOrder[0]).toBeLessThan(mocks.verifyEmail.mock.invocationCallOrder[0])
  })
  it('does not send email if the mapping could not be saved', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ code: 'service-unavailable' }) })
    await expect(requestMemberEmailVerification('target', 'new@example.com')).rejects.toThrow('profile.emailSync.failed')
    expect(mocks.verifyEmail).not.toHaveBeenCalled()
  })
  it('translates an SDK recent-login error when sending verification', async () => {
    mocks.verifyEmail.mockRejectedValue({ code: 'auth/requires-recent-login' })
    await expect(requestMemberEmailVerification('target', 'new@example.com')).rejects.toThrow('profile.emailSync.reauthRequired')
  })
  it('supports verification of an administrator-corrected email', async () => {
    await verifyCurrentMemberEmail()
    expect(mocks.verifyCurrent).toHaveBeenCalledWith(mocks.auth.currentUser, { url: `${window.location.origin}/profile?emailSync=1` })
  })
  it('syncs without sending a new email value', async () => {
    await updateMemberEmail('target', 'sync')
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ userId: 'target', mode: 'sync' })
  })
  it.each([
    ['email-in-use', 'inUse'], ['profile-sync-failed', 'syncFailed'], ['reauth-required', 'reauthRequired'],
    ['auth-account-missing', 'accountMissing'], ['verification-pending', 'pending'], ['change-busy', 'busy'], ['forbidden', 'forbidden'],
  ])('reports a controlled error for %s', async (code, key) => {
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ code }) })
    await expect(updateMemberEmail('target', 'request', 'new@example.com')).rejects.toThrow(`profile.emailSync.${key}`)
  })
  it('requires a signed-in user', async () => {
    mocks.auth.currentUser = null
    await expect(updateMemberEmail('target', 'sync')).rejects.toThrow('profile.emailSync.reauthRequired')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
