import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export interface NotificationRecipientSeed {
  userId: string;
  displayName?: string;
  email?: string;
  deviceIds?: string[];
  subscriptionIds?: string[];
}

export interface NotificationDeliveryInput {
  title: string;
  body: string;
  type: string;
  source: string;
  provider: 'fcm' | 'onesignal' | 'mixed';
  clickAction: string;
  recipients: NotificationRecipientSeed[];
  relatedId?: string;
  createdBy?: string;
}

export const createNotificationDelivery = async (
  db: Firestore,
  input: NotificationDeliveryInput,
) => {
  const ref = db.collection('notificationDeliveries').doc();
  await ref.set({
    title: input.title,
    body: input.body,
    type: input.type,
    source: input.source,
    provider: input.provider,
    clickAction: input.clickAction,
    relatedId: input.relatedId || null,
    createdBy: input.createdBy || 'system',
    status: 'processing',
    counts: {
      targeted: input.recipients.length,
      sent: 0,
      failed: 0,
      opened: 0,
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  for (let offset = 0; offset < input.recipients.length; offset += 400) {
    const batch = db.batch();
    input.recipients.slice(offset, offset + 400).forEach((recipient) => {
      batch.set(ref.collection('recipients').doc(recipient.userId), {
        userId: recipient.userId,
        displayName: recipient.displayName || 'Unnamed user',
        email: recipient.email || '',
        deviceIds: recipient.deviceIds || [],
        subscriptionIds: recipient.subscriptionIds || [],
        status: 'targeted',
        sent: 0,
        failed: 0,
        opened: false,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }

  return ref;
};

export const updateDeliveryRecipient = async (
  deliveryRef: FirebaseFirestore.DocumentReference,
  userId: string,
  data: Record<string, unknown>,
) => {
  await deliveryRef.collection('recipients').doc(userId).set({
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
};

export const completeNotificationDelivery = async (
  deliveryRef: FirebaseFirestore.DocumentReference,
  counts: { sent: number; failed: number },
  extra: Record<string, unknown> = {},
) => {
  await deliveryRef.set({
    status: counts.sent > 0 ? 'completed' : 'failed',
    counts: {
      sent: counts.sent,
      failed: counts.failed,
    },
    ...extra,
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
};

export const trackedClickAction = (clickAction: string, deliveryId: string) => {
  const separator = clickAction.includes('?') ? '&' : '?';
  return `${clickAction}${separator}notificationDelivery=${encodeURIComponent(deliveryId)}`;
};
