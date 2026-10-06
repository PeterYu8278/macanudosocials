import { auth } from '../../config/firebase'
import i18n from '../../i18n'
export async function ensureMemberProfile() {
  if (!auth.currentUser) throw new Error(i18n.t('auth.userNotFoundRelogin'))
  const token = await auth.currentUser.getIdToken()
  const response = await fetch('/.netlify/functions/ensure-member-profile', { method: 'POST',
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) })
  const result = await response.json() as { success?: boolean; code?: string; userId?: string }
  if (!response.ok || !result.success || !result.userId) {
    throw new Error(i18n.t(result.code === 'email-in-use' || result.code === 'identity-conflict' ? 'usersAdmin.accountIdentityConflict' : 'auth.saveProfileFailed'))
  }
  return result.userId
}
