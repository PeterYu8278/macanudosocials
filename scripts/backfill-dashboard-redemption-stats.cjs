// Dry-run by default. Deploy both Dashboard redemption triggers before applying.
const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { randomUUID } = require('node:crypto');
const { collections: C, VERSION, redemptionContributions, bucketRef, syncDashboardRedemptionStats } = require('../firebase-functions/dashboardRedemptionStats.cjs');

async function scan(db, name, visit) {
  let cursor;
  for (;;) {
    let query = db.collection(name).orderBy(FieldPath.documentId()).limit(200);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) await visit(doc);
    if (page.size < 200) return;
    cursor = page.docs.at(-1);
  }
}
async function reconcile(db, runId, apply) {
  const meta = db.collection(C.meta).doc('default');
  const gate = (await meta.get()).data();
  const expected = new Map(), existing = new Map();
  await scan(db, C.sources, async doc => {
    const data = doc.data();
    if (data.version !== VERSION) throw new Error('INVALID_REDEMPTION_CHECKPOINT');
    for (const [key, value] of Object.entries(data.counts || {})) {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_REDEMPTION_CHECKPOINT');
      const count = (expected.get(key) || 0) + value;
      if (!Number.isSafeInteger(count)) throw new Error('INVALID_REDEMPTION_COUNTER');
      expected.set(key, count);
    }
  });
  for (const scope of await db.collection(C.stats).listDocuments()) {
    await scan(db, `${scope.path}/buckets`, async doc => {
      existing.set(JSON.stringify([scope.id, doc.id]), doc.data());
    });
  }
  const mismatches = [...new Set([...expected.keys(), ...existing.keys()])].filter(key =>
    existing.get(key)?.version !== VERSION || existing.get(key)?.count !== (expected.get(key) || 0));
  for (const key of apply ? mismatches : []) await db.runTransaction(async tx => {
    const current = (await tx.get(meta)).data();
    if (current?.ready || current?.runId !== runId || current?.revision !== gate?.revision) throw new Error('BACKFILL_SOURCE_CHANGED');
    tx.set(bucketRef(db, key), { version: VERSION, count: expected.get(key) || 0 });
  });
  const confirmed = (await meta.get()).data();
  if (confirmed?.runId !== gate?.runId || confirmed?.revision !== gate?.revision) throw new Error('BACKFILL_SOURCE_CHANGED');
  return { mismatches: mismatches.length, revision: gate?.revision || 0 };
}
async function backfill(db, { apply = false, triggerDeployed = false, restartIncomplete = false } = {}) {
  if (apply && !triggerDeployed) throw new Error('DEPLOY_TRIGGERS_FIRST');
  const meta = db.collection(C.meta).doc('default'), runId = randomUUID();
  let records = 0;
  if (apply) await db.runTransaction(async tx => {
    const old = (await tx.get(meta)).data();
    if (old?.running && !restartIncomplete) throw new Error('BACKFILL_ALREADY_RUNNING');
    tx.set(meta, { version: VERSION, revision: old?.revision || 0, runId, running: true, ready: false,
      startedAt: new Date(), failure: null }, { merge: true });
  });
  try {
    // Repair existing checkpoints before subtracting edited/deleted contributions.
    if (apply) await reconcile(db, runId, true);
    await scan(db, C.records, async doc => {
      const data = doc.data();
      const session = await db.collection(C.sessions).doc(data.visitSessionId || doc.id).get();
      redemptionContributions(data, session.data());
      records++;
      if (apply) await syncDashboardRedemptionStats(db, doc.id);
    });
    if (apply) await scan(db, C.sources, doc => syncDashboardRedemptionStats(db, doc.id));
    const verification = await reconcile(db, runId, apply);
    if (apply) await db.runTransaction(async tx => {
      const current = (await tx.get(meta)).data();
      if (current?.runId !== runId || current?.revision !== verification.revision || current?.failure) throw new Error('BACKFILL_SOURCE_CHANGED');
      tx.update(meta, { ready: true, running: false, completedAt: new Date(), records });
    });
    return { mode: apply ? 'apply' : 'dry-run', records, ...verification, ready: apply };
  } catch (error) {
    if (apply) await db.runTransaction(async tx => {
      const current = (await tx.get(meta)).data();
      if (current?.runId === runId) tx.update(meta, { ready: false, running: false, failure: 'backfill-failed' });
    });
    throw error;
  }
}
if (require.main === module) {
  const project = process.argv.find(arg => arg.startsWith('--project='))?.slice(10);
  if (!project || !/^[a-z][a-z0-9-]{4,29}$/.test(project)) throw new Error('EXPLICIT_PROJECT_REQUIRED');
  initializeApp({ projectId: project, credential: process.env.FIREBASE_SERVICE_ACCOUNT
    ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault() });
  backfill(getFirestore(), { apply: process.argv.includes('--apply'), triggerDeployed: process.argv.includes('--trigger-deployed'),
    restartIncomplete: process.argv.includes('--restart-incomplete') })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(`Dashboard redemption backfill incomplete: ${error.message}`); process.exitCode = 1; });
}
module.exports = { scan, reconcile, backfill };
