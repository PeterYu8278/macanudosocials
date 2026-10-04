import { sendEmailVerification } from 'firebase/auth'
import { auth } from '../../config/firebase'
import i18n from '../../i18n'

export const normalizeMemberEmail = (email: string) => email.trim().toLowerCase()
export type MemberEmailMode = 'request' | 'send' | 'confirm' | 'correct' | 'sync' | 'cancel'
export class MemberEmailError extends Error {
  constructor(public code: string) {
    const key = code === 'email-in-use' || code === 'auth/email-already-in-use' ? 'inUse'
      : code === 'profile-sync-failed' || code === 'sync-required' ? 'syncFailed'
      : ['reauth-required', 'auth/requires-recent-login', 'auth-required', 'auth/user-token-expired', 'auth/id-token-revoked', 'auth/invalid-user-token'].includes(code) ? 'reauthRequired'
      : code === 'auth-account-missing' ? 'accountMissing'
      : code === 'verification-pending' ? 'pending'
      : code === 'legacy-verification-pending' ? 'legacyPending'
      : code === 'confirmation-invalid' ? 'invalidLink'
      : code === 'confirmation-expired' ? 'expiredLink'
      : code === 'email-delivery-unconfigured' ? 'mailUnconfigured'
      : code === 'email-send-too-soon' ? 'sendTooSoon'
      : code === 'email-delivery-failed' ? 'mailFailed'
      : code === 'change-busy' ? 'busy'
      : code === 'forbidden' ? 'forbidden' : 'failed'
    super(i18n.t(`profile.emailSync.${key}`))
  }
}

export async function updateMemberEmail(userId: string, mode: MemberEmailMode, email?: string, proof?: { changeId: string; confirmationToken: string }) {
  const current = auth.currentUser
  if (!current) throw new MemberEmailError('auth-required')
  try {
    const token = await current.getIdToken(true)
    const response = await fetch('/.netlify/functions/update-member-email', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId, mode, ...(email ? { email: normalizeMemberEmail(email) } : {}), ...(mode === 'confirm' ? proof : {}) }),
      signal: AbortSignal.timeout(20000),
    })
    const result = await response.json() as { success?: boolean; code?: string; email?: string; verified?: boolean }
    if (!response.ok || !result.success) throw new MemberEmailError(result.code || 'service-unavailable')
    return result
  } catch (error) {
    if (error instanceof MemberEmailError) throw error
    throw new MemberEmailError((error as { code?: string }).code || 'service-unavailable')
  }
}

export async function requestMemberEmailVerification(userId: string, email: string) {
  await updateMemberEmail(userId, 'send', normalizeMemberEmail(email))
}

export async function verifyCurrentMemberEmail() {
  if (!auth.currentUser) throw new MemberEmailError('auth-required')
  try {
    await sendEmailVerification(auth.currentUser, { url: new URL('/profile?emailSync=1', window.location.origin).href })
  } catch (error) { throw new MemberEmailError((error as { code?: string }).code || 'service-unavailable') }
}
