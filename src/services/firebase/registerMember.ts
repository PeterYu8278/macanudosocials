import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../../config/firebase'
import i18n from '../../i18n'
import { normalizePhoneNumber } from '../../utils/phoneNormalization'

export async function registerUser(email: string, password: string, displayName: string, phone: string, referralCode?: string) {
  const normalizedPhone = normalizePhoneNumber(phone)
  if (!email || !password || !displayName || !normalizedPhone) return {
    success: false as const, code: 'invalid-request', error: new Error(i18n.t('auth.registerFailed')),
  }
  const normalizedEmail = email.trim().toLowerCase()
  let provisioned = false
  try {
    const response = await fetch('/.netlify/functions/register-member', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, password, displayName, phone: normalizedPhone, referralCode }),
      signal: AbortSignal.timeout(30000),
    })
    const result = await response.json() as { success?: boolean; code?: string }
    if (!response.ok || !result.success) {
      const code = result.code || 'service-unavailable'
      const key = code === 'email-in-use' ? 'profile.emailUsed' : code === 'phone-in-use' ? 'profile.phoneUsed'
        : code === 'invalid-referral-code' ? 'auth.invalidReferralCode' : code === 'change-busy' ? 'profile.emailSync.busy'
        : code === 'registration-recovery-required' ? 'auth.registrationRecoveryRequired' : 'auth.registerFailedRetry'
      return { success: false as const, code, error: new Error(i18n.t(key)) }
    }
    provisioned = true
    const credential = await signInWithEmailAndPassword(auth, normalizedEmail, password)
    return { success: true as const, user: credential.user }
  } catch {
    return { success: false as const, code: provisioned ? 'registration-login-required' : 'registration-recovery-required',
      error: new Error(i18n.t(provisioned ? 'auth.registrationLoginRequired' : 'auth.registrationRecoveryRequired')) }
  }
}
