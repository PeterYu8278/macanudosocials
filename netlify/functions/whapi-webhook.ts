import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { initializeFirestore, Timestamp } from 'firebase-admin/firestore'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections'
import { toWebFunction, type EventHandler } from './_shared/webFunction'
import { receiveReceipt, type DeliveryStatus } from './_shared/whapiReceipts'
import { loadWhatsApp, submitWhapi, submitWhapiButtons, submitWhapiQuickReply, submitWhapiUrlButton } from './_shared/whatsapp'
import { createRegistrationToken, createWhatsAppMember, messageText, normalizeWhatsAppSender, registrationSessionRef, registrationTokenHash, startRegistration, type WhatsAppRegistrationSession } from './_shared/whatsappRegistration'

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
  if (allowlist.length > 0 && !allowlist.includes(phone)) {
    console.info('whatsapp-registration', { stage: 'not-allowlisted' })
    return
  }
  const text = messageText(message)
  const command = text.toLowerCase()
  const buttonId = typeof message.reply?.buttons_reply?.id === 'string' ? message.reply.buttons_reply.id : ''
  const restartReferral = /^register_start_([A-Z0-9]{6})$/i.exec(buttonId)?.[1]?.toUpperCase()
  const registrationCommand = restartReferral
    ? `/register ${restartReferral}`
    : command === 'to start again' ? '/register' : text
  const whapiToken = (await loadWhatsApp(db)).token
  if (!whapiToken) {
    console.error('whatsapp-registration', { stage: 'whapi-token-missing' })
    throw new Error('whapi-token-missing')
  }
  const send = async (body: string) => {
    if ((await submitWhapi(whapiToken, phone, body)).status !== 'accepted') throw new Error('whapi-send-failed')
  }
  const sendLogin = async () => {
    const loginUrl = `${(process.env.URL || 'https://macanudosocials.com').replace(/\/$/, '')}/?open=login&phone=${encodeURIComponent(phone)}`
    const body = 'This WhatsApp number is already registered. Tap Login now to sign in. If you forgot your password, use the password reset option on the website.'
    const result = await submitWhapiUrlButton(whapiToken, phone, body, 'Login now', loginUrl)
    if (result.status !== 'accepted') await send(`${body}\n${loginUrl}`)
  }
  const sendConfirmation = async (body: string) => {
    const result = await submitWhapiButtons(whapiToken, phone, body)
    if (result.status !== 'accepted') await send(`${body}\n\nReply CONFIRM to continue or CANCEL to cancel.`)
  }
  const ref = registrationSessionRef(db, phone)
  const existing = (await ref.get()).data() as WhatsAppRegistrationSession | undefined
  const expired = existing && existing.expiresAtMs <= Date.now()
  if (expired) await ref.set({ step: 'expired', expiredAt: Timestamp.now() }, { merge: true })

  const registerCommand = /^\/register(?:\s+([A-Z0-9]{6}))?$/i.exec(registrationCommand)
  if (registerCommand) {
    // Persist request limits across function instances and allow retries of the same webhook.
    const requestId = typeof message.id === 'string' ? message.id : ''
    if (!requestId) throw new Error('message-id-required')
    const rateRef = db.collection(C.WHATSAPP_INBOX).doc(`registration-rate-${createHash('sha256').update(phone).digest('hex')}`)
    const allowed = await db.runTransaction(async (transaction: any) => {
      const rate = (await transaction.get(rateRef)).data()
      const now = Date.now()
      if (rate?.requestId === requestId) return true
      const inWindow = rate && now - rate.windowStartedAtMs < 60 * 60_000
      if (rate && (now - rate.lastRequestAtMs < 60_000 || (inWindow && rate.count >= 5))) return false
      transaction.set(rateRef, { requestId, lastRequestAtMs: now,
        windowStartedAtMs: inWindow ? rate.windowStartedAtMs : now, count: inWindow ? rate.count + 1 : 1 })
      return true
    })
    // Silently drop excess requests to avoid amplification through outbound replies.
    if (!allowed) return
    const [phoneProfiles, legacyPhoneProfiles] = await Promise.all([
      db.collection(C.USERS).where('profile.phone', '==', phone).limit(1).get(),
      db.collection(C.USERS).where('phone', '==', phone).limit(1).get(),
    ])
    let phoneRegistered = !phoneProfiles.empty || !legacyPhoneProfiles.empty
    if (!phoneRegistered) {
      try {
        await getAuth().getUserByPhoneNumber(phone)
        phoneRegistered = true
      } catch (error) {
        if ((error as { code?: string })?.code !== 'auth/user-not-found') throw error
      }
    }
    if (phoneRegistered) {
      await sendLogin()
      return
    }
    const referralCode = registerCommand[1]?.toUpperCase()
    if (referralCode && (await db.collection(C.USERS).where('memberId', '==', referralCode).limit(1).get()).empty) {
      await send('This referral code is invalid. Please check the code and send /register REFERRALCODE again.')
      return
    }
    if (existing && !expired && existing.step === 'completed') {
      await sendLogin()
      return
    }
    if (existing && !expired && ['awaiting-form', 'awaiting-final-confirm'].includes(existing.step)) {
      await send(existing.step === 'awaiting-final-confirm'
        ? 'Your registration details are awaiting confirmation. Please tap Confirm in the previous message or reply CONFIRM.'
        : 'Your registration link is still valid. Please use Register now in the previous message. To restart, send CANCEL first.')
      return
    }
    const registrationToken = createRegistrationToken()
    await startRegistration(db, phone, message.chat_id, undefined, undefined, registrationTokenHash(registrationToken), referralCode)
    const baseUrl = process.env.URL || 'https://macanudosocials.com'
    const referralQuery = referralCode ? `&ref=${encodeURIComponent(referralCode)}` : ''
    const formUrl = `${baseUrl.replace(/\/$/, '')}/.netlify/functions/whatsapp-registration-form?token=${encodeURIComponent(registrationToken)}${referralQuery}`
    const formMessage = 'Welcome to Macanudo Socials. Tap Register now to enter your name, email, and password.\n\nThis link expires in 15 minutes.'
    try {
      const button = await submitWhapiUrlButton(whapiToken, phone, formMessage, 'Register now', formUrl)
      if (button.status !== 'accepted') await send(`${formMessage}\n${formUrl}`)
    } catch (error) {
      // Failed delivery must not leave the user stuck with an inaccessible valid link.
      await db.runTransaction(async (transaction: any) => {
        const current = (await transaction.get(ref)).data()
        if (current?.registrationTokenHash === registrationTokenHash(registrationToken) && current.step === 'awaiting-form') {
          transaction.set(ref, { step: 'expired', expiresAtMs: Date.now() }, { merge: true })
        }
      })
      throw error
    }
    return
  }
  if (command.startsWith('/register')) {
    await send('Invalid format. Please use /register or /register REFERRALCODE.')
    return
  }
  if (command === 'cancel' || command === '/cancel') {
    if (existing) await ref.set({ step: 'cancelled', cancelledAt: Timestamp.now() }, { merge: true })
    const restartId = existing?.referralCode ? `register_start_${existing.referralCode}` : 'register_start'
    const result = await submitWhapiQuickReply(whapiToken, phone, 'Registration cancelled.', 'To start again', restartId)
    if (result.status !== 'accepted') await send('Registration cancelled.\n\nReply /register to start again.')
    return
  }
  if (!existing || expired || existing.step !== 'awaiting-final-confirm') return
  const session = { ...existing, attempts: (existing.attempts || 0) + 1, updatedAt: Timestamp.now() } as WhatsAppRegistrationSession
  if (session.attempts > 12) {
    await ref.set({ step: 'locked', updatedAt: Timestamp.now() }, { merge: true })
    await send('Too many attempts. Registration has been paused. Please send /register again later.')
    return
  }
  if (command !== 'confirm') { await send('Please tap Confirm or reply CONFIRM to continue. You can also tap Cancel to cancel.'); return }
  try {
    const result = await createWhatsAppMember(db, session)
    const successText = '注册成功。请点击 Open App 打开 Macanudo Socials。'
    const button = await submitWhapiUrlButton(whapiToken, phone, successText, 'Open App', process.env.URL || 'https://macanudosocials.com')
    if (button.status !== 'accepted') await send(successText)
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === 'email-and-phone-in-use') await send('Both this email and phone number are already registered. Please use a different email and phone number.')
    else if (code === 'email-in-use') await send('This email is already registered. Please use a different email address.')
    else if (code === 'phone-in-use') await send('This phone number is already registered. Please use a different phone number.')
    else if (code === 'invalid-referral-code') await send('This referral code is invalid. Please start again with /register or /register REFERRALCODE.')
    else await send('Registration could not be completed. Please try again later or contact an administrator.')
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
      const owner = randomBytes(16).toString('hex')
      const inboxRef = messageId ? db.collection(C.WHATSAPP_INBOX).doc(createHash('sha256').update(`${channelId}:${messageId}`).digest('hex')) : null
      if (inboxRef) {
        const claim = await db.runTransaction(async (transaction: any) => {
          const snapshot = await transaction.get(inboxRef)
          const entry = snapshot.data()
          if (snapshot.exists && (!entry.status || entry.status === 'completed')) return 'completed'
          if (entry?.status === 'processing' && entry.leaseUntilMs > Date.now()) return 'busy'
          transaction.set(inboxRef, { messageId, channelId, status: 'processing', owner,
            leaseUntilMs: Date.now() + 120_000, receivedAt: Timestamp.now() }, { merge: true })
          return 'claimed'
        })
        if (claim === 'completed') return reply(200)
        if (claim === 'busy') return reply(503)
      }
      const finish = async (status: string) => {
        if (!inboxRef) return
        await db.runTransaction(async (transaction: any) => {
          if ((await transaction.get(inboxRef)).data()?.owner === owner) {
            transaction.set(inboxRef, { status, leaseUntilMs: 0, updatedAt: Timestamp.now() }, { merge: true })
          }
        })
      }
      try {
        await handleRegistrationMessage(db, payload)
        await finish('completed')
      } catch (error) {
        await finish('failed')
        throw error
      }
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
