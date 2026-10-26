// Node 22+; use --experimental-strip-types when needed. Dry-run is the default.
const { createHash } = require('node:crypto');

async function migrateSnapshots(db, { collections: C, correct, apply = false, actor = '', reportId = '', kind = 'all', max = 2000 }) {
  if (!['all', 'formal', 'test'].includes(kind) || !Number.isSafeInteger(max) || max < 1 || max > 10000
    || (reportId && !/^[\w-]{1,160}$/.test(reportId))) throw new Error('INVALID_OPTIONS');
  if (apply && !actor.trim()) throw new Error('ACTOR_REQUIRED');
  const names = kind === 'formal' ? [C.LOUNGE_REPORTS] : kind === 'test' ? [C.LOUNGE_TEST_REPORTS]
    : [C.LOUNGE_REPORTS, C.LOUNGE_TEST_REPORTS];
  const results = [];
  async function inspect(ref) {
    const result = await db.runTransaction(async tx => {
      const source = await tx.get(ref);
      if (!source.exists) return { id: ref.id, status: 'not-found' };
      const original = source.data(), details = original.debtDetails;
      if (!details || !Array.isArray(details.customers) || original.snapshotCorrection?.version === 1)
        return { id: ref.id, status: 'unchanged' };
      const corrected = correct(details);
      if (corrected === details) return { id: ref.id, status: 'unchanged' };
      const affected = corrected.customers.filter((row, i) => row !== details.customers[i]).length;
      if (!apply) return { id: ref.id, status: 'would-correct', affected };
      const backupId = createHash('sha256').update(ref.path).digest('hex');
      const backupRef = db.collection(C.LOUNGE_SNAPSHOT_BACKUPS).doc(backupId);
      const backup = await tx.get(backupRef);
      // An orphaned backup requires inspection; never overwrite earlier recovery evidence.
      if (backup.exists) throw new Error('BACKUP_ALREADY_EXISTS');
      if (Buffer.byteLength(JSON.stringify(original), 'utf8') > 850000) throw new Error('BACKUP_TOO_LARGE');
      const metadata = { version: 1, actor, at: new Date(), backupId, sourcePath: ref.path,
        mode: 'saved-evidence-only', affected };
      tx.create(backupRef, { original, correction: metadata });
      tx.update(ref, { debtDetails: corrected, snapshotCorrection: metadata });
      tx.create(db.collection(C.AUDIT_LOGS).doc(), { action: 'lounge-report-snapshot-correction',
        operatorId: actor, storeId: original.storeId, reportId: ref.id, ...metadata });
      return { id: ref.id, status: 'corrected', affected, backupId };
    }, apply ? undefined : { readOnly: true });
    results.push({ collection: ref.parent.id, ...result });
  }
  for (const name of names) {
    if (reportId) { await inspect(db.collection(name).doc(reportId)); continue; }
    let cursor;
    for (;;) {
      const remaining = max - results.length;
      if (remaining <= 0) return { apply, limitReached: true, results };
      let query = db.collection(name).orderBy('__name__').limit(Math.min(100, remaining));
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const doc of page.docs) await inspect(doc.ref);
      if (page.size < Math.min(100, remaining)) break;
      cursor = page.docs.at(-1);
    }
  }
  return { apply, limitReached: false, results };
}

async function main() {
  const args = process.argv.slice(2), value = flag => { const i = args.indexOf(flag); return i < 0 ? '' : args[i + 1] || ''; };
  const allowed = new Set(['--apply', '--project', '--actor', '--report-id', '--kind', '--max']);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error('UNKNOWN_OPTION');
    if (args[i] !== '--apply' && (!args[++i] || args[i].startsWith('--'))) throw new Error('MISSING_OPTION_VALUE');
  }
  if (value('--project') !== 'macanudosocial') throw new Error('EXPLICIT_PROJECT_REQUIRED');
  const { initializeApp, applicationDefault, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const credential = process.env.FIREBASE_SERVICE_ACCOUNT ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault();
  initializeApp({ projectId: 'macanudosocial', credential });
  const { GLOBAL_COLLECTIONS } = await import('../src/config/globalCollections.ts');
  const { correctLegacyLoungeDebtDetails } = await import('../src/utils/legacyLoungeReportSnapshot.ts');
  const output = await migrateSnapshots(getFirestore(), { collections: GLOBAL_COLLECTIONS, correct: correctLegacyLoungeDebtDetails,
    apply: args.includes('--apply'), actor: value('--actor'), reportId: value('--report-id'), kind: value('--kind') || 'all',
    max: value('--max') ? Number(value('--max')) : 2000 });
  console.log(JSON.stringify(output, null, 2));
}
module.exports = { migrateSnapshots };
if (require.main === module) main().catch(() => { console.error('Snapshot migration failed. Verify credentials, options and backup state; no secrets are logged.'); process.exitCode = 1; });
