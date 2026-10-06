import { auth } from '../../config/firebase'
export async function whatsappRequest<T = any>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('auth-required')
  const response = await fetch('/.netlify/functions/whatsapp-management', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, action }),
  })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(result.code || 'request-failed')
  return result
}
