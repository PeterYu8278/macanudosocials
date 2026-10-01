import i18n from '../../i18n'

export const requestPhonePasswordReset = async (phone: string) => {
  try {
    const response = await fetch('/.netlify/functions/phone-password-reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }), signal: AbortSignal.timeout(20000),
    })
    const result = await response.json()
    if (response.ok && result.success === true) return { success: true }
    return { success: false, error: i18n.t(response.status === 429 ? 'auth.phoneResetTooManyRequests' : 'auth.phoneResetUnavailable') }
  } catch {
    return { success: false, error: i18n.t('auth.phoneResetUnavailable') }
  }
}
