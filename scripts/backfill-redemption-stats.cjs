// Deploy syncRedemptionStats first. Preview: node scripts/backfill-redemption-stats.cjs
// Apply: add --apply --trigger-deployed, using GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT.
const { cert, initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { collections: C, countRedemptions, syncRedemptionStats, reconcileUserStats } = require('../firebase-functions/redemptionStats.cjs');
const { randomUUID } = require('node:crypto');

async function main() {
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--trigger-deployed')) throw new Error('DEPLOY_TRIGGER_FIRST');
  initializeApp({ projectId: 'macanudosocial', credential: process.env.FIREBASE_SERVICE_ACCOUNT
    ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault() });
  const db = getFirestore();
  const runId = randomUUID(), meta = db.collection(C.meta).doc('default');
  if (apply) await meta.set({ ready: false, runId, startedAt: new Date() });
  const owners = new Set(), sourceIds = new Set();
  let records = 0, completed = 0, pending = 0, orphans = 0;
  async function scan(name, visit) {
    let cursor;
    while (true) {
      let query = db.collection(name).orderBy(FieldPath.documentId()).limit(500);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const doc of page.docs) await visit(doc);
      if (page.size < 500) break;
      cursor = page.docs.at(-1);
    }
  }
  // Include checkpoints of deleted documents so a retry also repairs missed deletions.
  await scan(C.sources, async doc => { sourceIds.add(doc.id); if (doc.data().userId) owners.add(doc.data().userId); });
  await scan(C.records, async doc => {
    sourceIds.add(doc.id); records++;
    const value = doc.data();
    const userId = value.userId || (await db.collection(C.sessions).doc(value.visitSessionId || doc.id).get()).data()?.userId;
    if (!userId) { orphans++; return; }
    owners.add(userId);
    const totals = countRedemptions(value.redemptions, userId);
    completed += totals.completedQuantity; pending += totals.pendingQuantity;
  });
  if (apply && !orphans) {
    for (const id of sourceIds) await syncRedemptionStats(db, id);
    for (const userId of owners) await reconcileUserStats(db, userId, true);
    await db.runTransaction(async tx => {
      const current = await tx.get(meta);
      if (current.data()?.runId !== runId) throw new Error('NEWER_BACKFILL_RUNNING');
      tx.update(meta, { ready: true, completedAt: new Date(), records, users: owners.size });
    });
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', records, users: owners.size, completed, pending, orphans, ready: apply && !orphans }));
  if (orphans) throw new Error('UNRESOLVED_OWNERS');
}
main().catch(() => { console.error('Stats backfill incomplete. Check credentials, deployed trigger and unresolved legacy owners. Readiness is not published on failure.'); process.exitCode = 1; });
