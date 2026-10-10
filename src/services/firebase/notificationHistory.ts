import { collection, getDocs, limit, orderBy, query } from '@/services/firebase/monitoredFirestore'
import { db } from '../../config/firebase'

export interface NotificationDeliveryRecord {
  id: string
  title: string
  body: string
  type: string
  source: string
  provider: string
  clickAction: string
  status: string
  counts: { targeted: number; sent: number; failed: number; opened: number }
  createdAt: Date | null
}

export interface NotificationRecipientRecord {
  id: string
  userId: string
  displayName: string
  email: string
  status: string
  sent: number
  failed: number
  opened: boolean
  openedAt: Date | null
}

const asDate = (value: any): Date | null => value?.toDate?.() || null

export const getNotificationDeliveries = async (): Promise<NotificationDeliveryRecord[]> => {
  const snapshot = await getDocs(query(
    collection(db, 'notificationDeliveries'),
    orderBy('createdAt', 'desc'),
    limit(100),
  ))
  return snapshot.docs.map((entry) => {
    const data = entry.data()
    return {
      id: entry.id,
      title: data.title || '',
      body: data.body || '',
      type: data.type || 'system',
      source: data.source || 'unknown',
      provider: data.provider || 'unknown',
      clickAction: data.clickAction || '/',
      status: data.status || 'unknown',
      counts: {
        targeted: Number(data.counts?.targeted || 0),
        sent: Number(data.counts?.sent || 0),
        failed: Number(data.counts?.failed || 0),
        opened: Number(data.counts?.opened || 0),
      },
      createdAt: asDate(data.createdAt),
    }
  })
}

export const getNotificationRecipients = async (
  deliveryId: string,
): Promise<NotificationRecipientRecord[]> => {
  const snapshot = await getDocs(collection(db, 'notificationDeliveries', deliveryId, 'recipients'))
  return snapshot.docs.map((entry) => {
    const data = entry.data()
    return {
      id: entry.id,
      userId: data.userId || entry.id,
      displayName: data.displayName || 'Unnamed user',
      email: data.email || '',
      status: data.status || 'targeted',
      sent: Number(data.sent || 0),
      failed: Number(data.failed || 0),
      opened: data.opened === true,
      openedAt: asDate(data.openedAt),
    }
  })
}
