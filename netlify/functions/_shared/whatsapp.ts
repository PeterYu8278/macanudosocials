import type { Firestore } from 'firebase-admin/firestore'
import { formatWhatsAppMessage } from '../../../src/utils/whatsappMessage'
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections'
import { defaultWhatsAppSettings, type WhatsAppSettings } from '../../../src/types/whatsapp'
import { connectionError, resolveWhatsAppCredentials } from './whatsappCredentials'

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
  const credentials = resolveWhatsAppCredentials(saved, secret, legacy)
  return { config, ...credentials, legacyToken: legacy?.apiToken || '', migrationToken: secret?.whapiToken || legacy?.apiToken || '',
    verified: !!credentials.token && saved?.whapiVerified === true && saved?.whapiTokenHash === credentials.tokenHash }
}

// Bind work to the channel snapshot it was claimed with, never to a later replacement.
export async function assertWhatsAppBinding(db: Firestore, transaction: any, binding: string | undefined, requireVerified = false) {
  if (!binding) return
  const settings = (await transaction.get(db.collection(C.WHATSAPP_CONFIG).doc('settings'))).data()
  const secret = (await transaction.get(db.collection(C.WHATSAPP_CONFIG).doc('credentials'))).data()
  const legacy = (await transaction.get(db.collection(C.APP_CONFIG).doc('default'))).data()?.whapi
  const credentials = resolveWhatsAppCredentials(settings, secret, legacy)
  if (credentials.binding !== binding) throw connectionError('connection-changed')
  if (requireVerified && (!credentials.token || settings?.whapiVerified !== true || settings?.whapiTokenHash !== credentials.tokenHash)) throw connectionError('verification-required')
}

export async function submitWhapi(token: string, phone: string, text: string) {
  const response = await fetch('https://gate.whapi.cloud/messages/text', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: phone.replace(/^\+/, ''), body: formatWhatsAppMessage(text) }), signal: AbortSignal.timeout(10000),
  })
  // A failed/invalid response can follow a successful submission. Never automatically resend.
  if (!response.ok) return { status: response.status >= 500 ? 'unknown' : 'failed', messageId: '' }
  const body = await response.json()
  const id = body?.id || body?.message_id || body?.message?.id
  return { status: 'accepted', messageId: typeof id === 'string' ? id : '' }
}

export async function submitWhapiButtons(token: string, phone: string, text: string) {
  const response = await fetch('https://gate.whapi.cloud/messages/interactive', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'button', to: phone.replace(/^\+/, ''), body: { text: formatWhatsAppMessage(text) },
      action: { buttons: [
        { type: 'quick_reply', title: 'Confirm', id: 'register_confirm' },
        { type: 'quick_reply', title: 'Cancel', id: 'register_cancel' },
      ] },
    }), signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) return { status: response.status >= 500 ? 'unknown' : 'failed', messageId: '' }
  const body = await response.json()
  const id = body?.id || body?.message_id || body?.message?.id
  return { status: 'accepted', messageId: typeof id === 'string' ? id : '' }
}

export async function submitWhapiQuickReply(token: string, phone: string, text: string, title: string, id: string) {
  const response = await fetch('https://gate.whapi.cloud/messages/interactive', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'button', to: phone.replace(/^\+/, ''), body: { text: formatWhatsAppMessage(text) },
      action: { buttons: [{ type: 'quick_reply', title: title.slice(0, 20), id }] },
    }), signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) return { status: response.status >= 500 ? 'unknown' : 'failed', messageId: '' }
  const body = await response.json()
  const messageId = body?.id || body?.message_id || body?.message?.id
  return { status: 'accepted', messageId: typeof messageId === 'string' ? messageId : '' }
}

export async function submitWhapiUrlButton(token: string, phone: string, text: string, title: string, url: string) {
  const response = await fetch('https://gate.whapi.cloud/messages/interactive', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'button', to: phone.replace(/^\+/, ''), body: { text: formatWhatsAppMessage(text) },
      action: { buttons: [{ type: 'url', title: title.slice(0, 25), id: 'open_email', url }] },
    }), signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) return { status: response.status >= 500 ? 'unknown' : 'failed', messageId: '' }
  const body = await response.json()
  const id = body?.id || body?.message_id || body?.message?.id
  return { status: 'accepted', messageId: typeof id === 'string' ? id : '' }
}
