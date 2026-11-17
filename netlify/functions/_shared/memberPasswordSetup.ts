import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from './firestoreMonitoring'
import { GLOBAL_COLLECTIONS } from '../../../src/config/globalCollections'

export async function sendMemberPasswordSetup(email: string): Promise<'sent' | 'failed'> {
  // Delivery failure must not roll back an account whose profile was committed.
  try {
    const config = (await getFirestore().collection(GLOBAL_COLLECTIONS.APP_CONFIG).doc('default').get()).data()
    const provider = config?.emailProviders?.passwordReset ?? 'firebase'
    let response: Response
    if (provider === 'resend') {
      const key = process.env.RESEND_API_KEY
      const from = process.env.MEMBER_EMAIL_FROM
      if (!key || !from) return 'failed'
      const link = await getAuth().generatePasswordResetLink(email)
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email], subject: 'Set your Macanudo Socials password',
          text: `Your Macanudo Socials login account is ready. Set your own password using this secure link:\n${link}\n\nYour password is not included in this email. If you did not expect this account, contact Macanudo Socials.` }),
        signal: AbortSignal.timeout(10000),
      })
    } else if (provider === 'firebase') {
      const key = process.env.FIREBASE_WEB_API_KEY || process.env.VITE_FIREBASE_API_KEY
      if (!key) return 'failed'
      response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }), signal: AbortSignal.timeout(10000),
      })
    } else return 'failed'
    return response.ok ? 'sent' : 'failed'
  } catch { return 'failed' }
}
