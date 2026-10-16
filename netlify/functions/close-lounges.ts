import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from './_shared/firestoreMonitoring';
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections';
import { dispatchLoungeClosing } from './_shared/loungeDispatch';
import { localBusinessDate } from '../../src/utils/loungeOperations';
import { Timestamp } from 'firebase-admin/firestore';
import { toWebFunction } from './_shared/webFunction';

export const config = { schedule: '0,5,10 15 * * *' };
// Scheduled invocations are identified by Netlify, never by browser-supplied input.
export default toWebFunction(async () => {
  if (process.env.LOUNGE_OPERATIONS_ENABLED !== 'true') return { statusCode: 200 };
  if (!getApps().length) {
    const credentials = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!credentials) return { statusCode: 503 };
    initializeApp({ credential: cert(JSON.parse(credentials)) });
  }
  const db = getFirestore(), stores = await db.collection(C.STORES).get();
  let failed = 0;
  for (const store of stores.docs) {
    if (!store.data().operations?.enabled) continue;
    const date = localBusinessDate(new Date()), batchRef = db.collection(C.LOUNGE_BATCHES).doc(`${store.id}_${date}`);
    try {
      await db.runTransaction(async tx => {
        if (!(await tx.get(batchRef)).exists) tx.create(batchRef, { storeId: store.id, businessDate: date,
          status: 'queued', round: 0, revision: 1, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
      });
      await dispatchLoungeClosing(store.id, date);
    } catch {
      failed++;
      await batchRef.set({ lastError: 'dispatch-failed', updatedAt: Timestamp.now() }, { merge: true });
    }
  }
  return { statusCode: failed ? 500 : 200, body: JSON.stringify({ failed }) };
});
