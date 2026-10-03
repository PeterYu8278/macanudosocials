import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ token: vi.fn(), reload: vi.fn(), fetch: vi.fn(), auth: { currentUser: null as any } }))
vi.mock('../../config/firebase', () => ({ auth: mocks.auth }))
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }))
import { updateMemberPhone } from './memberPhone'
describe('updateMemberPhone', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.currentUser = { getIdToken: mocks.token, reload: mocks.reload }
    mocks.token.mockResolvedValue('fresh-token')
    vi.stubGlobal('fetch', mocks.fetch)
  })
  afterEach(() => vi.unstubAllGlobals())
  it('sends only the target ID and phone with a fresh ID token, never a password', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) })
    await updateMemberPhone('member', '+60123456789')
    expect(mocks.token).toHaveBeenCalledWith(true)
    expect(mocks.fetch.mock.calls[0][0]).toBe('/.netlify/functions/update-member-phone')
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ userId: 'member', phone: '+60123456789' })
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer fresh-token')
    expect(mocks.reload).toHaveBeenCalled()
  })
  it.each([
    ['phone-in-use', 'inUse'], ['reauth-required', 'reauthRequired'],
    ['profile-sync-failed', 'syncFailed'], ['auth-account-missing', 'accountMissing'],
    ['service-unavailable', 'failed'],
  ])('reports a controlled error for %s', async (code, key) => {
    mocks.fetch.mockResolvedValue({ ok: false, json: async () => ({ success: false, code }) })
    await expect(updateMemberPhone('member', '+60123456789')).rejects.toThrow(`profile.phoneSync.${key}`)
  })
  it('requires a signed-in user', async () => {
    mocks.auth.currentUser = null
    await expect(updateMemberPhone('member', '+60123456789')).rejects.toThrow('profile.phoneSync.reauthRequired')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
