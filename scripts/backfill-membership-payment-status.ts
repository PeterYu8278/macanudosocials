// Run with Node 22: node --experimental-strip-types scripts/backfill-membership-payment-status.ts [--apply]
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../src/config/globalCollections.ts';
import { membershipPaymentStatusData } from '../src/utils/membershipPaymentStatus.ts';

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('Credentials required');
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const db = getFirestore();
  const orders = await db.collection(C.MEMBERSHIP_PAYMENTS).where('status', 'in', ['creating', 'pending']).get();
  if (!process.argv.includes('--apply')) {
    console.log(`Dry run: ${orders.size} pending orders require status projection checks. Use --apply to synchronize.`);
    return;
  }
  let synchronized = 0;
  for (const order of orders.docs) {
    await db.runTransaction(async tx => {
      // Reread so a concurrent approval/cancellation cannot be overwritten by stale pending state.
      const current = await tx.get(order.ref);
      if (!current.exists) return;
      tx.set(db.collection(C.MEMBERSHIP_PAYMENT_STATUSES).doc(order.id), membershipPaymentStatusData(current.data()!));
    });
    synchronized++;
  }
  console.log(`Synchronized ${synchronized} order status projections. No wallets or private orders were changed.`);
}
main().catch(() => { console.error('Status backfill failed. Check server credentials and Firestore access.'); process.exitCode = 1; });
