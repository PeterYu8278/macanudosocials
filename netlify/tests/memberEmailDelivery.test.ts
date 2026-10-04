// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deliverMemberEmail, emailDeliveryConfig } from '../functions/_shared/memberEmailDelivery'

describe('member confirmation delivery', () => {
  const fetchMail = vi.fn()
  beforeEach(() => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('MEMBER_EMAIL_FROM', 'Macanudo Socials <test@example.com>')
    vi.stubEnv('MEMBER_EMAIL_ORIGIN', 'https://example.com')
    vi.stubGlobal('fetch', fetchMail)
    fetchMail.mockReset().mockResolvedValue({ ok: true })
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })
  it('sends only to the new mailbox and puts the proof in a URL fragment', async () => {
    await deliverMemberEmail('new@example.com', 'request', 'secret')
    const [url, options] = fetchMail.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(options.headers.Authorization).toBe('Bearer test-key')
    const email = JSON.parse(options.body)
    expect(email.to).toEqual(['new@example.com'])
    expect(email.text).toContain('https://example.com/profile#email-change=request&email-token=secret')
  })
  it.each(['', 'http://example.com', 'https://attacker@example.com', 'https://example.com/path'])('rejects an unsafe or missing deployment origin (%s)', origin => {
    vi.stubEnv('MEMBER_EMAIL_ORIGIN', origin)
    expect(() => emailDeliveryConfig()).toThrow('email-delivery-unconfigured')
    expect(fetchMail).not.toHaveBeenCalled()
  })
  it('fails closed when delivery credentials are missing', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    await expect(deliverMemberEmail('new@example.com', 'request', 'secret')).rejects.toThrow('email-delivery-unconfigured')
    expect(fetchMail).not.toHaveBeenCalled()
  })
  it('does not report success when the provider rejects delivery', async () => {
    fetchMail.mockResolvedValue({ ok: false })
    await expect(deliverMemberEmail('new@example.com', 'request', 'secret')).rejects.toThrow('email-delivery-failed')
  })
})
