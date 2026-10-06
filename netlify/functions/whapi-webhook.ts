import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { initializeFirestore, Timestamp } from 'firebase-admin/firestore'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
import { toWebFunction, type EventHandler } from './_shared/webFunction'
import { receiveReceipt, type DeliveryStatus } from './_shared/whapiReceipts'
import { loadWhatsApp, submitWhapi, submitWhapiButtons, submitWhapiUrlButton } from './_shared/whatsapp'
import { createRegistrationToken, createWhatsAppMember, messageText, normalizeWhatsAppSender, registrationSessionRef, registrationTokenHash, startRegistration, validateRegistrationEmail, type WhatsAppRegistrationSession } from './_shared/whatsappRegistration'

const reply = (statusCode: number) => ({ statusCode, headers: { 'Cache-Control': 'no-store' }, body: '' })
async function handleRegistrationMessage(db: any, payload: any) {
  if (process.env.WHATSAPP_REGISTRATION_ENABLED !== 'true') {
    console.info('whatsapp-registration', { stage: 'disabled' })
    return
  }
  const message = Array.isArray(payload.messages) ? payload.messages[0] : null
  if (!message || message.from_me === true || typeof message.chat_id !== 'string' || !message.chat_id.endsWith('@s.whatsapp.net')) {
    console.info('whatsapp-registration', { stage: 'ignored-sender' })
    return
  }
  const phone = normalizeWhatsAppSender(message.chat_id, message.from)
  if (!phone) {
    console.info('whatsapp-registration', { stage: 'invalid-sender' })
    return
  }
  const allowlist = (process.env.WHATSAPP_REGISTRATION_ALLOWLIST || '').split(',')
    .map(value => normalizeWhatsAppSender(value.trim(), value.trim()) || value.trim())
    .filter(Boolean)
  if (!allowlist.includes(phone)) {
    console.info('whatsapp-registration', { stage: 'not-allowlisted' })
    return
  }
  const text = messageText(message)
  const command = text.toLowerCase()
  const token = (await loadWhatsApp(db)).token
  if (!token) {
    console.error('whatsapp-registration', { stage: 'whapi-token-missing' })
    return
  }
  const send = async (body: string) => { await submitWhapi(token, phone, body) }
  const sendConfirmation = async (body: string) => {
    const result = await submitWhapiButtons(token, phone, body)
    if (result.status !== 'accepted') await send(`${body}\n\n请回复 CONFIRM 确认，或 CANCEL 取消。`)
  }
  const ref = registrationSessionRef(db, phone)
  const existing = (await ref.get()).data() as WhatsAppRegistrationSession | undefined
  const expired = existing && existing.expiresAtMs <= Date.now()
  if (expired) await ref.set({ step: 'expired', expiredAt: Timestamp.now() }, { merge: true })

  const registerMatch = /^\/register\s+(.+?)\s+([^\s@]+@[^\s@]+\.[^\s@]+)$/i.exec(text)
  if (registerMatch) {
    const displayName = registerMatch[1].trim()
    const email = validateRegistrationEmail(registerMatch[2])
    if (displayName.length < 2 || displayName.length > 128 || !email) {
      await send('格式不正确，请使用：/register 姓名 email@example.com')
      return
    }
    if (existing && !expired && existing.step === 'completed') {
      await send('这个 WhatsApp 号码已经注册过账号。如需恢复账号，请使用网站的密码重置功能。')
      return
    }
    await startRegistration(db, phone, message.chat_id, displayName, email)
    await sendConfirmation(`欢迎注册 Macanudo Socials。请确认注册资料：\n姓名：${displayName}\n电话：${phone}\nEmail：${email}`)
    return
  }
  if (command === '/register') {
    if (existing && !expired && existing.step === 'completed') {
      await send('这个 WhatsApp 号码已经注册过账号。如需恢复账号，请使用网站的密码重置功能。')
      return
    }
    const token = createRegistrationToken()
    await startRegistration(db, phone, message.chat_id, undefined, undefined, registrationTokenHash(token))
    const baseUrl = process.env.URL || 'https://macanudosocials.com'
    const formUrl = `${baseUrl.replace(/\/$/, '')}/.netlify/functions/whatsapp-registration-form?token=${encodeURIComponent(token)}`
    await send(`欢迎注册 Macanudo Socials。请点击链接填写姓名和 Email：\n${formUrl}\n\n链接 15 分钟内有效。`)
    return
  }
  if (command === 'cancel' || command === '/cancel') {
    if (existing) await ref.set({ step: 'cancelled', cancelledAt: Timestamp.now() }, { merge: true })
    await send('注册流程已取消。如需重新开始，请发送 /register。')
    return
  }
  if (!existing || expired || existing.step !== 'awaiting-final-confirm') return
  const session = { ...existing, attempts: (existing.attempts || 0) + 1, updatedAt: Timestamp.now() } as WhatsAppRegistrationSession
  if (session.attempts > 12) {
    await ref.set({ step: 'locked', updatedAt: Timestamp.now() }, { merge: true })
    await send('输入次数过多，注册流程已暂停。请稍后重新发送 /register。')
    return
  }
  if (command !== 'confirm') { await send('请点击 Confirm，或回复 CONFIRM 确认；也可以点击 Cancel 取消。'); return }
  try {
    const result = await createWhatsAppMember(db, session)
    const successText = '注册成功。请点击 Open App 打开 Macanudo Socials；如果浏览器支持安装，页面会显示 PWA 安装提示。'
    const button = await submitWhapiUrlButton(token, phone, successText, 'Open App', process.env.URL || 'https://macanudosocials.com')
    if (button.status !== 'accepted') await send(successText)
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === 'email-and-phone-in-use') await send('该 Email 和电话号码都已经注册，请使用其他 Email 和电话号码。')
    else if (code === 'email-in-use') await send('该 Email 已经注册，请使用其他 Email。')
    else if (code === 'phone-in-use') await send('该电话号码已经注册，请使用其他电话号码。')
    else await send('注册暂时无法完成，请稍后再试或联系管理员。')
  }
}
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
    const rawEvent = payload.event || {}
    const method = rawEvent.method || rawEvent.event
    const eventType = rawEvent.type || (typeof rawEvent.event === 'string' ? rawEvent.event.split('.')[0] : '')
    const eventMethod = typeof method === 'string' ? method.split('.').at(-1) : method
    if (eventType === 'messages' && ['post', 'put'].includes(eventMethod)) {
      const message = Array.isArray(payload.messages) ? payload.messages[0] : null
      const messageId = typeof message?.id === 'string' ? message.id : ''
      if (messageId) {
        const inboxRef = db.collection(C.WHATSAPP_INBOX).doc(createHash('sha256').update(`${channelId}:${messageId}`).digest('hex'))
        if ((await inboxRef.get()).exists) return reply(200)
        await inboxRef.set({ messageId, channelId, receivedAt: Timestamp.now() })
      }
      await handleRegistrationMessage(db, payload)
      await settings.set({ whapiWebhookAt: Timestamp.now() }, { merge: true })
      return reply(200)
    }
    if (eventType !== 'statuses' || !['post', 'put'].includes(eventMethod)) return reply(200)
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
