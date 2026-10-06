import type { Firestore } from 'firebase-admin/firestore'
import { createHash } from 'node:crypto'
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections'
import { defaultWhatsAppSettings, type WhatsAppSettings } from '../../../src/types/whatsapp'

export async function loadWhatsApp(db: Firestore) {
  const saved = (await db.collection(C.WHATSAPP_CONFIG).doc('settings').get()).data()
  const legacy = (await db.collection(C.APP_CONFIG).doc('default').get()).data()?.whapi
  const config: WhatsAppSettings = saved?.config || {
    ...defaultWhatsAppSettings, enabled: legacy?.enabled ?? false,
    defaultProvider: legacy?.enabled ? 'whapi' : 'manual',
    features: { eventReminder: legacy?.features?.eventReminder ?? false,
      vipExpiry: legacy?.features?.vipExpiry ?? false, passwordReset: legacy?.features?.passwordReset ?? false },
    whapi: { channelId: legacy?.channelId || '' },
  }
  const secret = (await db.collection(C.WHATSAPP_CONFIG).doc('credentials').get()).data()
  const token = process.env.WHAPI_API_TOKEN || secret?.whapiToken || legacy?.apiToken || ''
  const tokenHash = createHash('sha256').update(token).digest('hex')
  return { config, token, tokenHash, legacyToken: legacy?.apiToken || '', migrationToken: secret?.whapiToken || legacy?.apiToken || '',
    verified: saved?.whapiVerified === true && saved?.whapiTokenHash === tokenHash }
}

export async function submitWhapi(token: string, phone: string, text: string) {
  const response = await fetch('https://gate.whapi.cloud/messages/text', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: phone.replace(/^\+/, ''), body: text }), signal: AbortSignal.timeout(10000),
  })
  // A failed/invalid response can follow a successful submission. Never automatically resend.
  if (!response.ok) return { status: response.status >= 500 ? 'unknown' : 'failed', messageId: '' }
  const body = await response.json()
  const id = body?.id || body?.message_id || body?.message?.id
  return { status: 'accepted', messageId: typeof id === 'string' ? id : '' }
}
