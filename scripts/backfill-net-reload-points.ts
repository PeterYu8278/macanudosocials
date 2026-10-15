// Node 22: node --experimental-strip-types scripts/backfill-net-reload-points.ts [--apply]
import { cert, initializeApp } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../src/config/globalCollections.ts';
import { netReloadPointsMigration as conversion } from '../src/utils/reloadPoints.ts';

let stage = 'credentials';
async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('MISSING_SERVICE_ACCOUNT');
  let serviceAccount;
  try { serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); }
  catch { throw new Error('INVALID_SERVICE_ACCOUNT_JSON'); }
  stage = 'initialize';
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore(), apply = process.argv.includes('--apply');
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let eligible = 0, changed = 0, skipped = 0;
  while (true) {
    let query = db.collection(C.RELOAD_RECORDS).orderBy(FieldPath.documentId()).limit(500);
    if (cursor) query = query.startAfter(cursor);
    stage = 'read';
    const page = await query.get();
    for (const document of page.docs) {
      if (!conversion(document.data())) { skipped++; continue; }
      eligible++;
      if (apply) {
        stage = 'write';
        await db.runTransaction(async tx => {
        const current = await tx.get(document.ref);
        const update = current.exists ? conversion(current.data()!) : null;
        if (update) { tx.update(document.ref, update); }
        return Boolean(update);
      }).then(updated => { if (updated) changed++; });
      }
    }
    if (page.size < 500) break;
    cursor = page.docs.at(-1);
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', eligible, changed, skipped }));
  console.log('Only reload point metadata changes; wallets, ledgers and annual fee records are untouched.');
}
main().catch((error: unknown) => {
  const failure = error as { message?: string; code?: string | number };
  const reason = failure.message === 'MISSING_SERVICE_ACCOUNT'
    ? 'FIREBASE_SERVICE_ACCOUNT is missing in this shell. Load your service account JSON before running.'
    : failure.message === 'INVALID_SERVICE_ACCOUNT_JSON'
      ? 'FIREBASE_SERVICE_ACCOUNT is not valid JSON. Load the complete service account JSON.'
      : failure.code === 7 || failure.code === 'permission-denied'
        ? 'Firestore permission denied. Check the service account IAM access to the target project.'
        : failure.code === 16 || failure.code === 'unauthenticated'
          ? 'Authentication failed. Check whether the service account key is valid.'
          : stage === 'initialize'
            ? 'Firebase Admin initialization failed. Check the service account fields.'
            : 'Firestore operation failed. Check credentials, project access and network connectivity.';
  // SDK error messages can contain credential material; report only controlled diagnostics.
  console.error(`Net points backfill failed at ${stage}: ${reason}`);
  process.exitCode = 1;
});
