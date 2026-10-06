import { createHash } from 'node:crypto'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections'

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed'
export interface Receipt { status: DeliveryStatus; statusAtMs: number }
export const receiptId = (channel: string, message: string) => createHash('sha256').update(JSON.stringify([channel, message])).digest('hex')

export function advanceReceipt(current: Partial<Receipt> | undefined, next: Receipt): Receipt | undefined {
  const rank = { sent: 1, delivered: 2, read: 3, failed: 0 }
  if (!current?.status) return next
  if (current.status === next.status) return undefined
  if (rank[current.status] >= 2 && rank[next.status] <= rank[current.status]) return undefined
  if (rank[next.status] >= 2) return next
  if (next.statusAtMs < (current.statusAtMs || 0)) return undefined
  return next
}

export async function receiveReceipt(db: Firestore, channelId: string, messageId: string, next: Receipt) {
  const ref = db.collection(C.WHATSAPP_RECEIPTS).doc(receiptId(channelId, messageId))
  // Also reconcile pre-webhook records that already stored a provider message ID.
  const matches = await db.collection(C.WHATSAPP_TASKS).where('messageId', '==', messageId).limit(2).get()
  const matching = matches.docs.filter(doc => {
    const task = doc.data()
    return task.provider === 'whapi' && (!task.channelId || task.channelId === channelId)
  })
  await db.runTransaction(async transaction => {
    const previous = (await transaction.get(ref)).data()
    const taskId = previous?.taskId || (matching.length === 1 ? matching[0].id : '')
    const taskRef = taskId ? db.collection(C.WHATSAPP_TASKS).doc(taskId) : null
    const task = taskRef ? (await transaction.get(taskRef)).data() : undefined
    const changed = advanceReceipt(previous as Partial<Receipt> | undefined, next)
    const effective = changed || previous as Receipt | undefined
    if (changed) transaction.set(ref, { ...changed, channelId, messageId, taskId,
      receivedAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 30 * 86400000) }, { merge: true })
    if (taskRef && task?.provider === 'whapi' && (!task.channelId || task.channelId === channelId) && effective) {
      const update = advanceReceipt(task.status === 'sent' || task.status === 'failed' || task.status === 'delivered' || task.status === 'read'
        ? task as Receipt : undefined, effective)
      if (update) transaction.update(taskRef, { ...update, updatedAt: Timestamp.now() })
    }
  })
}

export async function attachSubmission(db: Firestore, taskId: string, channelId: string,
  submitted: { status: string; messageId: string }) {
  const taskRef = db.collection(C.WHATSAPP_TASKS).doc(taskId)
  const receiptRef = submitted.messageId && channelId
    ? db.collection(C.WHATSAPP_RECEIPTS).doc(receiptId(channelId, submitted.messageId)) : null
  return db.runTransaction(async transaction => {
    const task = (await transaction.get(taskRef)).data()
    const receipt = receiptRef ? (await transaction.get(receiptRef)).data() : undefined
    const existingStatus = task?.status && ['sent', 'delivered', 'read'].includes(task.status) ? task.status : ''
    const status = receipt?.status || existingStatus || submitted.status
    transaction.update(taskRef, { ...submitted, channelId, status,
      ...(receipt?.statusAtMs ? { statusAtMs: receipt.statusAtMs } : {}), updatedAt: Timestamp.now() })
    if (receiptRef) transaction.set(receiptRef, { taskId, channelId, messageId: submitted.messageId,
      expiresAt: Timestamp.fromMillis(Date.now() + 30 * 86400000) }, { merge: true })
    return status as string
  })
}
