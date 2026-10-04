import { MemberIdentityError } from './memberIdentity'

export function emailDeliveryConfig() {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MEMBER_EMAIL_FROM
  const origin = process.env.MEMBER_EMAIL_ORIGIN
  if (!key || !from || !origin) throw new MemberIdentityError('email-delivery-unconfigured', 503)
  let url: URL
  try { url = new URL(origin) } catch { throw new MemberIdentityError('email-delivery-unconfigured', 503) }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new MemberIdentityError('email-delivery-unconfigured', 503)
  }
  return { key, from, origin: url.origin }
}

export async function deliverMemberEmail(email: string, id: string, token: string) {
  const config = emailDeliveryConfig()
  // A fragment is not sent to the HTTP server in access logs or referrer headers.
  const url = `${config.origin}/profile#email-change=${encodeURIComponent(id)}&email-token=${token}`
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.from, to: [email], subject: 'Confirm your Macanudo Socials email change',
      text: `Confirm your new email address:\n${url}\n\nSign in to your existing account, then confirm the change on Profile. If necessary, reopen this link after signing in. This link expires in one hour. Cancelling the request or requesting another link makes this link invalid. If you did not request this change, do not confirm it.` }),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new MemberIdentityError('email-delivery-failed', 503)
}
