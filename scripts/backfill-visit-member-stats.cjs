// Preview by default. Apply only after deploying the visit trigger and private rules:
// node scripts/backfill-visit-member-stats.cjs --project PROJECT --apply --trigger-deployed
const { cert, initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { randomUUID } = require('node:crypto');
const { collections: C, visitContribution, syncVisitMemberStats, reconcileVisitMemberStats } = require('../firebase-functions/visitMemberStats.cjs');

async function backfillVisitMemberStats(db, { apply = false, triggerDeployed = false } = {}) {
  if (apply && !triggerDeployed) throw new Error('DEPLOY_TRIGGER_FIRST');
  const runId = randomUUID(), metaRef = db.collection(C.meta).doc('default');
  if (apply) await db.runTransaction(async tx => {
    const meta = await tx.get(metaRef);
    if (meta.data()?.running) throw new Error('BACKFILL_ALREADY_RUNNING');
    tx.set(metaRef, { version: 1, ready: false, running: true, runId, startedAt: new Date() });
  });
  const sourceIds = new Set(), owners = new Set();
  let records = 0, completedHours = 0;
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
  try {
    await scan(C.users, async doc => { owners.add(doc.id); });
    await scan(C.stats, async doc => { owners.add(doc.id); });
    await scan(C.sources, async doc => {
      sourceIds.add(doc.id);
      if (doc.data().userId) owners.add(doc.data().userId);
    });
    await scan(C.sessions, async doc => {
      const value = visitContribution(doc.data()); // Unattributed/invalid history blocks readiness.
      sourceIds.add(doc.id); owners.add(value.userId);
      records++; completedHours += value.completedHours;
    });
    if (apply) {
      // Restore the checkpoint baseline before applying negative source deltas.
      // Both reconciliations transact with the live trigger while readiness is off.
      for (const id of owners) await reconcileVisitMemberStats(db, id, true);
      for (const id of sourceIds) await syncVisitMemberStats(db, id);
      for (const id of owners) await reconcileVisitMemberStats(db, id, true);
      await db.runTransaction(async tx => {
        const current = await tx.get(metaRef);
        if (current.data()?.runId !== runId || current.data()?.running !== true) throw new Error('BACKFILL_LOCK_LOST');
        tx.update(metaRef, { ready: true, running: false, completedAt: new Date(), records, users: owners.size });
      });
    }
    return { mode: apply ? 'apply' : 'dry-run', records, users: owners.size, completedHours, ready: apply };
  } catch (error) {
    if (apply) await db.runTransaction(async tx => {
      const current = await tx.get(metaRef);
      if (current.data()?.runId === runId) tx.update(metaRef, { ready: false, running: false, failedAt: new Date() });
    });
    throw error;
  }
}

async function main() {
  const project = process.argv[process.argv.indexOf('--project') + 1];
  if (!process.argv.includes('--project') || !project || project.startsWith('--')) throw new Error('EXPLICIT_PROJECT_REQUIRED');
  initializeApp({ projectId: project, credential: process.env.FIREBASE_SERVICE_ACCOUNT
    ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault() });
  console.log(JSON.stringify(await backfillVisitMemberStats(getFirestore(), {
    apply: process.argv.includes('--apply'), triggerDeployed: process.argv.includes('--trigger-deployed'),
  })));
}
if (require.main === module) main().catch(() => {
  console.error('Visit stats backfill incomplete; readiness was not published. Check deployed trigger, credentials and source validation.');
  process.exitCode = 1;
});
module.exports = { backfillVisitMemberStats };
