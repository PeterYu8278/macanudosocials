import { getAuth } from 'firebase-admin/auth'
import { type Firestore, Timestamp } from 'firebase-admin/firestore'
import { randomBytes, randomInt } from 'node:crypto'
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections'
import { normalizePhoneNumber } from '../../../src/utils/phoneNormalization'
import { MemberIdentityError } from './memberIdentity'
import { assertUniqueMemberIdentity, lockMemberIdentity } from './memberIdentityLock'
import { sendMemberPasswordSetup } from './memberPasswordSetup'

export type RegistrationStep = 'awaiting-confirmation' | 'awaiting-name' | 'awaiting-email' | 'awaiting-final-confirm'

export interface WhatsAppRegistrationSession {
  phone: string
  chatId: string
  step: RegistrationStep
  displayName?: string
  email?: string
  expiresAtMs: number
  attempts: number
  createdAt: Timestamp
  updatedAt: Timestamp
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const sessionId = (phone: string) => Buffer.from(phone).toString('base64url')

export function registrationSessionRef(db: Firestore, phone: string) {
  return db.collection(C.WHATSAPP_REGISTRATION_SESSIONS).doc(sessionId(phone))
}

export function normalizeWhatsAppSender(chatId: unknown, from: unknown) {
  const value = typeof chatId === 'string' && chatId.endsWith('@s.whatsapp.net')
    ? chatId.slice(0, -'@s.whatsapp.net'.length)
    : typeof from === 'string' && /^\d+$/.test(from) ? from : ''
  return value ? normalizePhoneNumber(value) : null
}

export function messageText(message: any) {
  const body = message?.text?.body ?? message?.text
  return typeof body === 'string' ? body.trim().slice(0, 500) : ''
}

export async function startRegistration(db: Firestore, phone: string, chatId: string) {
  const now = Timestamp.now()
  const session: WhatsAppRegistrationSession = {
    phone, chatId, step: 'awaiting-confirmation', expiresAtMs: Date.now() + 15 * 60_000,
    attempts: 0, createdAt: now, updatedAt: now,
  }
  await registrationSessionRef(db, phone).set(session)
  return session
}

export async function createWhatsAppMember(db: Firestore, session: WhatsAppRegistrationSession) {
  if (!session.displayName || !session.email) throw new MemberIdentityError('invalid-registration', 400)
  const unlock = await lockMemberIdentity(db, [`email:${session.email}`, `phone:${session.phone}`])
  let uid: string | undefined
  try {
    await assertUniqueMemberIdentity(db, session.email, session.phone)
    const account = await getAuth().createUser({
      email: session.email, phoneNumber: session.phone,
      displayName: session.displayName, password: randomBytes(32).toString('base64url'), emailVerified: false,
    })
    uid = account.uid
    const users = db.collection(C.USERS)
    const now = Timestamp.now()
    const memberId = await db.runTransaction(async transaction => {
      let candidate = ''
      for (let attempt = 0; attempt < 10; attempt++) {
        const next = randomInt(36 ** 6).toString(36).toUpperCase().padStart(6, '0')
        if ((await transaction.get(users.where('memberId', '==', next).limit(1))).empty) { candidate = next; break }
      }
      if (!candidate) throw new Error('member-id-unavailable')
      transaction.create(users.doc(account.uid), {
        authUid: account.uid, email: session.email, displayName: session.displayName, memberId: candidate,
        role: 'guest', status: 'inactive', registrationSource: 'whatsapp',
        profile: { phone: session.phone, phoneAuth: { uid: account.uid, ownershipVerified: true, updatedBy: account.uid, updatedAt: now } },
        emailAuth: { uid: account.uid, verified: false, syncedAt: now },
        whatsappAuth: { chatId: session.chatId, verifiedAt: now },
        preferences: { locale: 'zh', notifications: true },
        membership: { level: 'bronze', joinDate: now, lastActive: now, points: 0, referralPoints: 0 },
        createdAt: now, updatedAt: now,
      })
      transaction.create(db.collection(C.AUDIT_LOGS).doc(), { action: 'register-member-whatsapp', userId: account.uid, createdAt: now })
      return candidate
    })
    const passwordSetupEmail = await sendMemberPasswordSetup(session.email)
    await registrationSessionRef(db, session.phone).set({ step: 'completed', completedAt: now, uid: account.uid, memberId, passwordSetupEmail }, { merge: true })
    return { uid: account.uid, memberId, passwordSetupEmail }
  } catch (error) {
    if (uid) {
      try {
        const profile = await db.collection(C.USERS).doc(uid).get()
        if (!profile.exists) await getAuth().deleteUser(uid)
      } catch { /* The audit/session record allows manual recovery. */ }
    }
    const code = (error as { code?: string })?.code
    if (error instanceof MemberIdentityError) throw error
    if (code === 'auth/email-already-exists') throw new MemberIdentityError('email-in-use', 409)
    if (code === 'auth/phone-number-already-exists') throw new MemberIdentityError('phone-in-use', 409)
    throw error
  } finally {
    await unlock().catch(() => undefined)
  }
}

export function validateRegistrationEmail(value: string) {
  const email = value.trim().toLowerCase()
  return email.length <= 254 && emailPattern.test(email) ? email : null
}

export function maskEmail(email: string) {
  const [local, domain] = email.split('@')
  return `${local.slice(0, 1)}***@${domain}`
}
