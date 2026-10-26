// Explicit maintenance; defaults to read-only preview. Requires Node 22 with TypeScript stripping.
const { createHash } = require('node:crypto');
async function refreshReports(db, C, refresh, { apply = false, actor = '', max = 1000 } = {}) {
  if (apply && !actor.trim()) throw new Error('ACTOR_REQUIRED');
  if (!Number.isSafeInteger(max) || max < 1 || max > 1000) throw new Error('INVALID_LIMIT');
  const results = [];
  for (const name of [C.LOUNGE_REPORTS, C.LOUNGE_TEST_REPORTS]) {
    const page = await db.collection(name).orderBy('__name__').limit(max + 1).get();
    if (page.size > max) throw new Error('REPORT_LIMIT');
    for (const doc of page.docs) {
      const result = await db.runTransaction(async tx => {
        const original = (await tx.get(doc.ref)).data();
        if (!original?.debtDetails?.customers?.length || original.debtDetails.historyRefresh?.version === 1)
          return { id: doc.id, status: 'unchanged' };
        const ledger = await tx.get(db.collection(C.POINTS_RECORDS).orderBy('__name__').limit(10001));
        if (ledger.size > 10000) throw new Error('LEDGER_LIMIT');
        const sources = ledger.docs.map(item => {
          const row = item.data();
          return { id: item.id, createdAt: item.createTime.toMillis(), updatedAt: item.updateTime.toMillis(),
            record: { ...row, at: row.createdAt?.toMillis?.() ?? new Date(row.createdAt).getTime(),
              amount: typeof row.amount === 'number' && row.amount >= 0 && ['earn', 'spend'].includes(row.type)
                ? (row.type === 'earn' ? 1 : -1) * row.amount : NaN, before: row.balanceBefore, after: row.balance } };
        });
        const details = refresh(original.debtDetails, original.storeId, sources, new Date().toISOString());
        if (!details) return { id: doc.id, status: 'unrecoverable' };
        const summary = { id: doc.id, status: apply ? 'refreshed' : 'would-refresh', customers: details.customers.length,
          reconciled: details.customers.filter(row => row.reliable).length, review: details.customers.filter(row => !row.reliable).length,
          entries: details.customers.reduce((sum, row) => sum + row.entries.length, 0), skipped: details.historyRefresh.skippedCustomers };
        if (!apply) return summary;
        const backupId = createHash('sha256').update(`${doc.ref.path}:zero-origin-history-v1`).digest('hex');
        const backup = db.collection(C.LOUNGE_SNAPSHOT_BACKUPS).doc(backupId);
        if ((await tx.get(backup)).exists) throw new Error('BACKUP_EXISTS');
        if (Buffer.byteLength(JSON.stringify(original), 'utf8') > 850000 || Buffer.byteLength(JSON.stringify(details), 'utf8') > 700000) throw new Error('SNAPSHOT_LIMIT');
        const metadata = { version: 1, actor, at: new Date(), backupId, sourcePath: doc.ref.path, mode: 'zero-origin-original-cutoff' };
        tx.create(backup, { original, correction: metadata });
        tx.update(doc.ref, { debtDetails: details, historyRefresh: metadata });
        tx.create(db.collection(C.AUDIT_LOGS).doc(), { action: 'lounge-debt-history-refresh', operatorId: actor,
          storeId: original.storeId, reportId: doc.id, ...metadata });
        return summary;
      }, apply ? undefined : { readOnly: true });
      results.push({ collection: name, ...result });
    }
  }
  return { apply, results };
}
module.exports = { refreshReports };
async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--project=macanudosocial', '--apply', '--actor=user-authorized-via-codex'].includes(arg)) || !args.includes('--project=macanudosocial')) throw new Error('INVALID_OPTIONS');
  const { initializeApp, applicationDefault } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ projectId: 'macanudosocial', credential: applicationDefault() });
  const { GLOBAL_COLLECTIONS: C } = await import('../src/config/globalCollections.ts');
  const { refreshLoungeDebtHistory } = await import('../src/utils/refreshLoungeDebtHistory.ts');
  console.log(JSON.stringify(await refreshReports(getFirestore(), C, refreshLoungeDebtHistory, {
    apply: args.includes('--apply'), actor: args.includes('--actor=user-authorized-via-codex') ? 'user-authorized-via-codex' : '' }), null, 2));
}
if (require.main === module) main().catch(() => { console.error('History refresh failed; inspect credentials, limits and backup state.'); process.exitCode = 1; });
