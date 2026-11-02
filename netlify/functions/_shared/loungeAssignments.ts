import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';
import { managedLoungeIds } from '../../../src/utils/loungeAccess';
import { loungeError } from './loungeVisits';

async function globalActor(tx: any, db: Firestore, uid: string) {
  let user = (await tx.get(db.collection(C.USERS).doc(uid))).data();
  if (!user) {
    const linked = await tx.get(db.collection(C.USERS).where('authUid', '==', uid).limit(2));
    if (linked.size === 1) user = linked.docs[0].data();
  }
  if (!user || !['superAdmin', 'developer'].includes(user.role) || user.status === 'suspended') throw loungeError('forbidden');
}
export async function loungeAssignments(db: Firestore, uid: string, input: any) {
  return db.runTransaction(async tx => {
    await globalActor(tx, db, uid);
    const store = await tx.get(db.collection(C.STORES).doc(input.storeId));
    if (!store.exists) throw loungeError('lounge-unavailable');
    if (input.action === 'list-lounge-admins') {
      const users = await tx.get(db.collection(C.USERS).where('role', 'in', ['admin', 'storeAdmin']).limit(501));
      if (users.size > 500) throw loungeError('scan-limit');
      return { admins: users.docs.map(doc => ({ id: doc.id, name: String(doc.data().displayName || doc.id),
        role: doc.data().role, storeIds: managedLoungeIds(doc.data()) })) };
    }
    if (typeof input.userId !== 'string' || !/^[\w-]{1,160}$/.test(input.userId) || typeof input.assigned !== 'boolean'
      || !Array.isArray(input.expectedStoreIds) || input.expectedStoreIds.some((id: unknown) => typeof id !== 'string')) throw loungeError('invalid-request');
    const ref = db.collection(C.USERS).doc(input.userId), target = await tx.get(ref), data = target.data();
    if (!data || !['admin', 'storeAdmin'].includes(data.role)) throw loungeError('invalid-request');
    const before = managedLoungeIds(data);
    if (JSON.stringify(before) !== JSON.stringify([...new Set(input.expectedStoreIds)].sort())) throw loungeError('assignment-conflict');
    const after = input.assigned ? [...new Set([...before, input.storeId])].sort() : before.filter(id => id !== input.storeId);
    if (after.length > 100) throw loungeError('invalid-request');
    if (JSON.stringify(before) === JSON.stringify(after)) return { storeIds: after };
    const primary = after.includes(data.storeId) ? data.storeId : after[0] || null;
    tx.update(ref, { storeIds: after, storeId: primary, updatedAt: Timestamp.now() });
    tx.create(db.collection(C.AUDIT_LOGS).doc(), { action: 'lounge-admin-assignment', operatorId: uid,
      userId: target.id, storeId: input.storeId, before: { storeId: data.storeId ?? null, storeIds: before },
      after: { storeId: primary, storeIds: after }, createdAt: Timestamp.now() });
    return { storeIds: after };
  });
}
