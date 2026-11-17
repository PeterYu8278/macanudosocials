import { collection, doc, runTransaction, Timestamp } from './monitoredFirestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS as C } from '../../config/globalCollections';
import { DEFAULT_GUEST_PAGE, validateGuestPage, nextGuestPageRevision, type GuestPageConfig } from '../../config/guestPage';
import { invalidateAppConfigCache } from './appConfig';
import { sanitizeForFirestore } from './core/sanitize';

/** Append-only offer history; contact edits and audit history commit atomically. */
export async function saveGuestPage(value: GuestPageConfig, operatorId: string) {
  validateGuestPage(value);
  const ref = doc(db, C.APP_CONFIG, 'default');
  const audit = doc(collection(db, C.AUDIT_LOGS));
  const result = await runTransaction(db, async tx => {
    const snapshot = await tx.get(ref);
    const previous: GuestPageConfig = snapshot.data()?.guestPage || DEFAULT_GUEST_PAGE;
    const next = nextGuestPageRevision(previous, value);
    tx.set(ref, sanitizeForFirestore({ guestPage: next, updatedAt: Timestamp.now(), updatedBy: operatorId }), { merge: true });
    tx.set(audit, sanitizeForFirestore({ module: 'system', action: 'update', targetId: 'default', operatorId, timestamp: Timestamp.now(),
      description: 'Update public guest page', details: { before: previous, after: next } }));
    return next;
  });
  invalidateAppConfigCache();
  return result;
}
