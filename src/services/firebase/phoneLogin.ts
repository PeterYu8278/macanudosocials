import { signInWithCustomToken } from 'firebase/auth'
import { auth } from '../../config/firebase'
import i18n from '../../i18n'

export const loginPhoneWithPassword = async (phone: string, password: string) => {
  try {
    const response = await fetch('/.netlify/functions/phone-login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
      signal: AbortSignal.timeout(20000),
    })
    const result = await response.json() as { success?: boolean; customToken?: string; code?: string }
    if (!response.ok || !result.success || !result.customToken) {
      const code = result.code || 'auth/service-unavailable'
      const key = code === 'auth/too-many-requests' ? 'phoneLoginTooManyAttempts'
        : code === 'auth/invalid-credential' ? 'phoneLoginInvalidCredentials' : 'phoneLoginUnavailable'
      const defaults = {
        phoneLoginTooManyAttempts: 'Too many attempts. Please try again in 5 minutes.',
        phoneLoginInvalidCredentials: 'Incorrect phone number or password',
        phoneLoginUnavailable: 'Phone login is temporarily unavailable. Please try again later.',
      }
      return { success: false as const, error: new Error(i18n.t(`auth.${key}`, { defaultValue: defaults[key] })), code }
    }
    const credential = await signInWithCustomToken(auth, result.customToken)
    return { success: true as const, user: credential.user }
  } catch {
    return { success: false as const, error: new Error(i18n.t('auth.phoneLoginUnavailable', { defaultValue: 'Phone login is temporarily unavailable. Please try again later.' })), code: 'auth/service-unavailable' }
  }
}
