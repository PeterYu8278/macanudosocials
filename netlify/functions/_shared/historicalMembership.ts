import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';

// This collection is server-only under Firestore's default-deny rules. Profile
// dates and ordinary audit logs are not sufficient evidence of activation.
export async function verifiedHistoricalActivationAt(db: Firestore, userId: string, tx?: Transaction): Promise<Date | null> {
  const ref = db.collection(C.MEMBERSHIP_ACTIVATIONS).doc(userId);
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  const evidence = snapshot.data();
  if (!snapshot.exists || evidence?.version !== 1 || evidence.userId !== userId
    || evidence.source !== 'owner_confirmed_historical' || evidence.status !== 'verified'
    || evidence.revokedAt || typeof evidence.auditLogId !== 'string' || !evidence.auditLogId.trim()) return null;
  const asDate = (value: any): Date | null => {
    const result = value?.toDate?.() || (value ? new Date(value) : null);
    return result instanceof Date && Number.isFinite(result.getTime()) ? result : null;
  };
  const activated = asDate(evidence.activatedAt), verified = asDate(evidence.verifiedAt);
  const now = Date.now();
  return activated && verified && activated.getTime() <= verified.getTime() && verified.getTime() <= now ? activated : null;
}
