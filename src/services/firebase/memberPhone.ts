import { auth } from '../../config/firebase'
import i18n from '../../i18n'

export const updateMemberPhone = async (userId: string, phone: string) => {
  const current = auth.currentUser
  if (!current) throw new Error(i18n.t('profile.phoneSync.reauthRequired'))
  const token = await current.getIdToken(true)
  const response = await fetch('/.netlify/functions/update-member-phone', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId, phone }), signal: AbortSignal.timeout(20000),
  })
  const result = await response.json() as { success?: boolean; code?: string }
  if (!response.ok || !result.success) {
    const key = result.code === 'phone-in-use' ? 'inUse'
      : result.code === 'reauth-required' ? 'reauthRequired'
      : result.code === 'profile-sync-failed' ? 'syncFailed'
      : result.code === 'auth-account-missing' ? 'accountMissing' : 'failed'
    throw new Error(i18n.t(`profile.phoneSync.${key}`))
  }
  // A reload failure must not turn a confirmed server-side save into a failure.
  try { await current.reload() } catch { /* The next verification refreshes the Auth profile. */ }
}
