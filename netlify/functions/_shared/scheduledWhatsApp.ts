import { createHash } from 'node:crypto'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections'
import { normalizePhoneNumber } from '../../../src/utils/phoneNormalization'
import { loadWhatsApp, submitWhapi } from './whatsapp'
import { attachSubmission } from './whapiReceipts'

const DAY = 86400000
const date = (value: any): Date => value?.toDate?.() || new Date(value)
const formatDate = (value: Date) => new Intl.DateTimeFormat('en-MY', {
  timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short',
}).format(value)

interface Reminder {
  kind: 'event_reminder' | 'vip_expiry'
  relatedId: string
  userId: string
  milestone: string
  text: (name: string) => string
}

export async function runScheduledWhatsApp(db: Firestore, now = new Date()) {
  const loaded = await loadWhatsApp(db)
  const result = { accepted: 0, failed: 0, unknown: 0, duplicate: 0, skipped: 0, deferred: false }
  const { config } = loaded
  if (!config.enabled || config.defaultProvider !== 'whapi' || !loaded.token || !loaded.verified) return result

  // Each hourly run can continue remaining recipients without resending completed or uncertain submissions.
  const deadline = Date.now() + 12000
  const dayStart = Math.floor((now.getTime() + 8 * 3600000) / DAY) * DAY - 8 * 3600000
  const reminders: Reminder[] = []
  if (config.features.eventReminder) {
    const events = await db.collection(C.EVENTS)
      .where('schedule.startDate', '>=', Timestamp.fromMillis(dayStart + DAY))
      .where('schedule.startDate', '<', Timestamp.fromMillis(dayStart + 2 * DAY)).get()
    for (const event of events.docs) {
      const data = event.data()
      if (!['published', 'upcoming'].includes(data.status)) continue
      const start = date(data.schedule?.startDate)
      if (!Number.isFinite(start.getTime())) continue
      const registered = Array.isArray(data.participants?.registered) ? data.participants.registered : []
      for (const userId of new Set<string>(registered.filter((id: unknown) => typeof id === 'string' && !id.includes('/')))) {
        reminders.push({ kind: 'event_reminder', relatedId: event.id, userId,
          milestone: String(start.getTime()),
          text: name => `Hi ${name}, reminder: ${data.title || 'your event'} starts on ${formatDate(start)} at ${data.location?.name || data.location?.address || 'the lounge'}. See you there!`,
        })
      }
    }
  }
  if (config.features.vipExpiry) {
    // Filter status in memory to avoid introducing a composite Firestore index.
    const fees = await db.collection(C.MEMBERSHIP_FEE_RECORDS)
      .where('dueDate', '>=', Timestamp.fromMillis(dayStart + DAY))
      .where('dueDate', '<', Timestamp.fromMillis(dayStart + 8 * DAY)).get()
    for (const fee of fees.docs) {
      const data = fee.data()
      const due = date(data.dueDate)
      const daysBefore = Math.floor((due.getTime() - dayStart) / DAY)
      if (data.status !== 'pending' || ![7, 3, 1].includes(daysBefore)
        || typeof data.userId !== 'string' || data.userId.includes('/')) continue
      reminders.push({ kind: 'vip_expiry', relatedId: fee.id, userId: data.userId,
        milestone: `${due.getTime()}:${daysBefore}d`,
        text: name => `Hi ${name}, your Annual Pass renewal is due on ${formatDate(due)} (${daysBefore} day${daysBefore === 1 ? '' : 's'} remaining). Renew to continue enjoying your member benefits.`,
      })
    }
  }

  for (const reminder of reminders) {
    if (Date.now() >= deadline) { result.deferred = true; break }
    const id = createHash('sha256').update(JSON.stringify([
      'scheduled', reminder.kind, reminder.relatedId, reminder.userId, reminder.milestone,
    ])).digest('hex')
    const task = db.collection(C.WHATSAPP_TASKS).doc(id)
    // Recheck the user and business record inside the claim transaction.
    const recipient = await db.runTransaction(async transaction => {
      const existing = await transaction.get(task)
      if (existing.exists) { result.duplicate++; return null }
      const user = (await transaction.get(db.collection(C.USERS).doc(reminder.userId))).data()
      const business = (await transaction.get(db.collection(
        reminder.kind === 'event_reminder' ? C.EVENTS : C.MEMBERSHIP_FEE_RECORDS,
      ).doc(reminder.relatedId))).data()
      const eligible = reminder.kind === 'event_reminder'
        ? business && ['published', 'upcoming'].includes(business.status)
          && business.participants?.registered?.includes(reminder.userId)
          && String(date(business.schedule?.startDate).getTime()) === reminder.milestone
        : business?.status === 'pending' && business.userId === reminder.userId
          && reminder.milestone.startsWith(`${date(business.dueDate).getTime()}:`)
      const phone = normalizePhoneNumber(user?.profile?.phone || user?.phone || '')
      if (!eligible || !user || ['inactive', 'suspended'].includes(user.status)
        || user.preferences?.whatsapp !== true || !phone) { result.skipped++; return null }
      transaction.create(task, { provider: 'whapi', kind: reminder.kind, userId: reminder.userId,
        relatedId: reminder.relatedId, milestone: reminder.milestone, source: 'scheduled',
        phone: `***${phone.slice(-4)}`, test: false, status: 'submitting', createdAt: Timestamp.now() })
      return { phone, name: user.displayName || user.name || 'Member' }
    })
    if (!recipient) continue
    let submitted
    try { submitted = await submitWhapi(loaded.token, recipient.phone, reminder.text(recipient.name).slice(0, 4000)) }
    catch { submitted = { status: 'unknown', messageId: '' } }
    await attachSubmission(db, id, config.whapi.channelId, submitted)
    if (submitted.status === 'accepted') result.accepted++
    else if (submitted.status === 'failed') result.failed++
    else result.unknown++
  }
  return result
}
