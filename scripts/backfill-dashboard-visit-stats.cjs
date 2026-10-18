// Explicit maintenance command. Dry-run reads only; never invoked by application startup.
const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
const { getFirestore, FieldPath } = require('firebase-admin/firestore');
const { randomUUID } = require('node:crypto');
const { collections: C, normalizeVisit, sameSource, counterKeys, scopeForStore, syncDashboardVisitStats, refreshDashboardVisitOccupancy } = require('../firebase-functions/dashboardVisitStats.cjs');

async function scan(db, collection, visit) {
  let cursor;
  for (;;) {
    let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(250);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    for (const doc of page.docs) await visit(doc);
    if (page.size < 250) return;
    cursor = page.docs.at(-1);
  }
}

async function backfill(db, { apply = false, triggerDeployed = false, restartIncomplete = false } = {}) {
  if (apply && !triggerDeployed) throw new Error('DEPLOY_TRIGGER_FIRST');
  const ref = db.collection(C.meta).doc('default');
  const runId = randomUUID();
  let records = 0, excludedInvalidDates = 0, verification = null;
  if (apply) await db.runTransaction(async tx => {
    const meta = (await tx.get(ref)).data();
    if (meta?.bootstrapping && !restartIncomplete) throw new Error('BOOTSTRAP_ALREADY_RUNNING');
    tx.set(ref, { ready: false, bootstrapping: true, runId, version: 1, offsetMinutes: 480,
      revision: meta?.revision ?? 0, startedAt: new Date(), failure: null, occupancy: null, workerCheckedAt: null }, { merge: true });
  });
  try {
    await scan(db, C.sessions, async doc => {
      records++;
      if (!normalizeVisit(doc.data(), doc.id)) excludedInvalidDates++;
      if (apply) await syncDashboardVisitStats(db, doc.id);
    });
    // Also revisit checkpoints so missed source deletions are removed on rerun.
    if (apply) {
      await scan(db, C.sources, doc => syncDashboardVisitStats(db, doc.id));
      verification = await verifyDashboardCounters(db, { runId, repair: true });
      await db.runTransaction(async tx => {
        const meta = (await tx.get(ref)).data();
        if (meta?.runId !== runId || meta.failure || meta.revision !== verification.revision) throw new Error('BOOTSTRAP_NOT_CLEAN');
        tx.set(ref, { ready: true, bootstrapping: false, completedAt: new Date(), records, excludedInvalidDates }, { merge: true });
      });
      await refreshDashboardVisitOccupancy(db);
    } else verification = await verifyDashboardCounters(db);
    return { mode: apply ? 'apply' : 'dry-run', records, excludedInvalidDates, verification };
  } catch (error) {
    if (apply) await db.runTransaction(async tx => {
      const meta = (await tx.get(ref)).data();
      if (meta?.runId === runId) tx.set(ref, { ready: false, bootstrapping: false, failure: 'bootstrap-failed' }, { merge: true });
    });
    throw error;
  }
}

async function verifyDashboardCounters(db, { runId, repair = false } = {}) {
  const metaRef = db.collection(C.meta).doc('default');
  const baseline = (await metaRef.get()).data();
  const revision = baseline?.revision ?? 0;
  const expected = new Map();
  let unprojectedSources = 0;
  await scan(db, C.sessions, async doc => {
    const checkpoint = (await db.collection(C.sources).doc(doc.id).get()).data();
    if (!sameSource(checkpoint?.source ?? null, normalizeVisit(doc.data(), doc.id))) unprojectedSources++;
  });
  if (repair && unprojectedSources) throw new Error('BOOTSTRAP_UNPROJECTED_SOURCES');
  await scan(db, C.sources, async doc => {
    const data = doc.data();
    if (data.version !== 1) throw new Error('INVALID_VISIT_CHECKPOINT');
    if (!data.source) return;
    const scopes = ['all', ...(data.source.storeId ? [scopeForStore(data.source.storeId)] : [])];
    for (const scope of scopes) for (const key of counterKeys(data.source)) {
      const path = `${C.stats}/${scope}/buckets/${key}`;
      expected.set(path, (expected.get(path) ?? 0) + 1);
    }
  });
  const stored = new Map();
  // listDocuments includes missing ancestor documents that have bucket subcollections.
  for (const scope of await db.collection(C.stats).listDocuments()) {
    await scan(db, `${scope.path}/buckets`, async doc => stored.set(`${scope.path}/buckets/${doc.id}`, doc.data()));
  }
  const mismatches = [...new Set([...expected.keys(), ...stored.keys()])].filter(path => {
    const data = stored.get(path);
    return !data || data.version !== 1 || data.count !== (expected.get(path) ?? 0);
  });
  for (const path of repair ? mismatches : []) {
    await db.runTransaction(async tx => {
      const meta = (await tx.get(metaRef)).data();
      if (meta?.runId !== runId || meta.ready || !meta.bootstrapping || meta.revision !== revision) throw new Error('BOOTSTRAP_SOURCE_CHANGED');
      tx.set(db.doc(path), { version: 1, count: expected.get(path) ?? 0 });
    });
  }
  const confirmed = (await metaRef.get()).data();
  if ((confirmed?.revision ?? 0) !== revision || confirmed?.runId !== baseline?.runId) throw new Error('BOOTSTRAP_SOURCE_CHANGED');
  return { revision, buckets: Math.max(expected.size, stored.size), mismatches: mismatches.length,
    unprojectedSources, repaired: repair ? mismatches.length : 0, verified: unprojectedSources === 0 && (repair || mismatches.length === 0) };
}

if (require.main === module) {
  const projectId = process.argv.find(arg => arg.startsWith('--project='))?.slice('--project='.length);
  if (!projectId) throw new Error('Explicit --project=<firebase-project-id> is required');
  initializeApp({ projectId, credential: process.env.FIREBASE_SERVICE_ACCOUNT
    ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault() });
  backfill(getFirestore(), { apply: process.argv.includes('--apply'), triggerDeployed: process.argv.includes('--trigger-deployed'),
    restartIncomplete: process.argv.includes('--restart-incomplete') })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(`Dashboard visit bootstrap incomplete: ${error.message}`); process.exitCode = 1; });
}
module.exports = { backfill, scan, verifyDashboardCounters };
