import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../../config/firebase'
import { getAppConfig } from './appConfig'

export async function sendRecoveryEmail(email: string): Promise<'firebase' | 'resend'> {
  const config = await getAppConfig()
  if (config?.emailProviders?.passwordReset !== 'resend') {
    await sendPasswordResetEmail(auth, email)
    return 'firebase'
  }
  const response = await fetch('/.netlify/functions/email-password-reset', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(result.code || 'password-reset-unavailable')
  return 'resend'
}
