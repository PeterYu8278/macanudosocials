import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';
import { membershipPaymentStatusData } from '../../../src/utils/membershipPaymentStatus';

export function writeMembershipPaymentStatus(db: Firestore, tx: Transaction, orderId: string, order: Record<string, unknown>) {
  tx.set(db.collection(C.MEMBERSHIP_PAYMENT_STATUSES).doc(orderId), membershipPaymentStatusData(order));
}
