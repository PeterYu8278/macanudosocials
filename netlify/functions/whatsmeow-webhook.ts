import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { initializeFirestore } from './_shared/firestoreMonitoring'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
import { toWebFunction, type EventHandler } from './_shared/webFunction'
import { attachSubmission, receiveReceipt } from './_shared/whapiReceipts'
import { loadMeow, registeredGateways, submitMeow, verifyGatewayCallback } from './_shared/whatsmeow'
import { handleRegistrationMessage } from './whapi-webhook'
import { tokenDigest } from './_shared/whatsappCredentials'

const reply = (statusCode: number) => ({ statusCode, headers: { 'Cache-Control': 'no-store' }, body: '' })
export const eventHandler: EventHandler = async event => {
  if (event.httpMethod !== 'POST') return reply(405)
  if (!event.body || event.body.length > 16000 || event.isBase64Encoded) return reply(400)
  try {
    const input = JSON.parse(event.body)
    if (!input || typeof input.gatewayId !== 'string' || !registeredGateways()[input.gatewayId]
      || !/^[\w-]{1,100}$/.test(input.sessionId) || typeof input.messageId !== 'string' || !input.messageId || input.messageId.length > 200) return reply(400)
    const keys = JSON.parse(process.env.WHATSMEOW_CALLBACK_SECRETS || '{}')
    if (!verifyGatewayCallback(event.headers, event.body, typeof keys[input.gatewayId] === 'string' ? keys[input.gatewayId] : '')) return reply(401)
    if (!getApps().length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) return reply(503)
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) })
    }
    const db = initializeFirestore(getApps()[0], { preferRest: true })
    const channelId = `whatsmeow:${input.gatewayId}:${input.sessionId}`
    const statusAtMs = input.statusAtMs
    if (!Number.isSafeInteger(statusAtMs) || statusAtMs < 0 || statusAtMs > Date.now() + 60000) return reply(400)
    // Both operations are idempotent. Old sessions can complete their own tasks, never new-session tasks.
    if (input.type === 'submission') {
      if (!/^[\w-]{1,100}$/.test(input.requestId) || !['sent', 'unknown', 'failed'].includes(input.status)) return reply(400)
      const task = (await db.collection(C.WHATSAPP_TASKS).doc(input.requestId).get()).data()
      if (task?.provider !== 'whatsmeow' || task.channelId !== channelId) return reply(200)
      await attachSubmission(db, input.requestId, channelId, { status: input.status, messageId: input.messageId })
    } else if (input.type === 'receipt') {
      if (!['sent', 'delivered', 'read'].includes(input.status)) return reply(400)
      await receiveReceipt(db, channelId, input.messageId, { status: input.status, statusAtMs }, false, 'whatsmeow')
    } else if (input.type === 'message') {
      if (!/^\+[1-9]\d{6,14}$/.test(input.phone) || typeof input.text !== 'string' || input.text.length > 500) return reply(400)
      if (statusAtMs < Date.now() - 120000) return reply(200)
      const active = await loadMeow(db)
      const settings = (await db.collection(C.WHATSAPP_CONFIG).doc('settings').get()).data()
      if (settings?.config?.defaultProvider !== 'whatsmeow' || active.gatewayId !== input.gatewayId || active.sessionId !== input.sessionId) return reply(200)
      const inbox = db.collection(C.WHATSAPP_INBOX).doc(`meow-${tokenDigest(`${channelId}:${input.messageId}`)}`)
      const claim = await db.runTransaction(async tx => {
        const data = (await tx.get(inbox)).data()
        if (data?.done) return 'done'
        if (data?.leaseUntilMs > Date.now()) return 'busy'
        tx.set(inbox, { leaseUntilMs: Date.now() + 30000 }, { merge: true })
        return 'claimed'
      })
      if (claim === 'done') return reply(200)
      if (claim === 'busy') return reply(503)
      try {
        await handleRegistrationMessage(db, { messages: [{ id: input.messageId, from_me: false,
          chat_id: `${input.phone.slice(1)}@s.whatsapp.net`, text: { body: input.text } }] }, {
          binding: `whatsmeow:${active.version}`,
          send: (phone, text) => submitMeow(active, tokenDigest(`${channelId}:${input.messageId}:${text}`), phone, text, statusAtMs + 120000),
        })
        await inbox.set({ done: true, leaseUntilMs: 0, expiresAt: new Date(Date.now() + 86400000) }, { merge: true })
      } catch (error) { await inbox.set({ leaseUntilMs: 0 }, { merge: true }); throw error }
    } else return reply(400)
    return reply(200)
  } catch { return reply(503) }
}

export default toWebFunction(eventHandler)
