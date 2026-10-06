import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { initializeFirestore, Timestamp } from 'firebase-admin/firestore'
import { createHash, timingSafeEqual } from 'node:crypto'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
import { toWebFunction, type EventHandler } from './_shared/webFunction'
import { receiveReceipt, type DeliveryStatus } from './_shared/whapiReceipts'

const reply = (statusCode: number) => ({ statusCode, headers: { 'Cache-Control': 'no-store' }, body: '' })
export const eventHandler: EventHandler = async event => {
  if (event.httpMethod !== 'POST') return reply(405)
  const secret = process.env.WHAPI_WEBHOOK_SECRET
  if (!secret || secret.length < 32) return reply(503)
  const authorization = event.headers.authorization || ''
  const hash = (value: string) => createHash('sha256').update(value).digest()
  if (!timingSafeEqual(hash(authorization), hash(`Bearer ${secret}`))) return reply(401)
  if (!event.body || Buffer.byteLength(event.body) > 65536) return reply(400)
  let payload
  try { payload = JSON.parse(event.body) } catch { return reply(400) }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply(400)
  try {
    if (!getApps().length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) return reply(503)
      const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      initializeApp({ projectId: account.project_id, credential: cert(account) })
    }
    const db = initializeFirestore(getApps()[0], { preferRest: true })
    const settings = db.collection(C.WHATSAPP_CONFIG).doc('settings')
    const channelId = (await settings.get()).data()?.config?.whapi?.channelId
    if (!channelId || payload.channel_id !== channelId) return reply(403)
    const method = payload.event?.method || payload.event?.event
    if (payload.event?.type !== 'statuses' || !['post', 'put'].includes(method)) return reply(200)
    if (!Array.isArray(payload.statuses) || payload.statuses.length > 100) return reply(400)
    const receipts: Array<{ id: string; status: DeliveryStatus; statusAtMs: number }> = []
    for (const status of payload.statuses) {
      if (!status || typeof status.id !== 'string' || !status.id || status.id.length > 200
        || typeof status.status !== 'string') return reply(400)
      if (!['sent', 'delivered', 'read', 'played', 'failed'].includes(status.status)) continue
      const seconds = typeof status.timestamp === 'string' && /^\d+(\.\d+)?$/.test(status.timestamp)
        || typeof status.timestamp === 'number' ? Number(status.timestamp) : NaN
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > Date.now() + 300000) return reply(400)
      receipts.push({ id: status.id, status: status.status === 'played' ? 'read' : status.status, statusAtMs: seconds * 1000 })
    }
    for (let index = 0; index < receipts.length; index += 5) {
      await Promise.all(receipts.slice(index, index + 5).map(receipt => receiveReceipt(db, channelId, receipt.id, receipt)))
    }
    await settings.set({ whapiWebhookAt: Timestamp.now() }, { merge: true })
    return reply(200)
  } catch { return reply(503) }
}

export default toWebFunction(eventHandler)
