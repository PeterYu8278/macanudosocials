const { scopeForStore } = require('./dashboardVisitStats.cjs');
const C = { records: 'redemptionRecords', sessions: 'visitSessions', sources: '_dashboardRedemptionStatsSources',
  stats: '_dashboardRedemptionStats', meta: '_dashboardRedemptionStatsMeta' };
const VERSION = 1;
function redemptionBucketKeys(value) {
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value);
  if (value == null || !Number.isFinite(date.getTime())) throw new Error('INVALID_REDEMPTION_TIME');
  return [`hour_${date.toISOString().slice(0, 13)}`, `day_${new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10)}`];
}
function redemptionContributions(data, session) {
  if (!data) return {};
  if (!Array.isArray(data.redemptions)) throw new Error('INVALID_REDEMPTION_ITEMS');
  const counts = new Map();
  for (const item of data.redemptions) {
    if (!item || item.type === 'referral_reward' || item.cigarId === 'referral_reward'
      || !['pending', 'completed'].includes(item.status || 'completed')) continue;
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error('INVALID_REDEMPTION_QUANTITY');
    const owner = session?.userId || data.userId;
    if (owner && item.userId && item.userId !== owner) continue;
    const storeId = session?.storeId || data.storeId;
    if (!storeId) throw new Error('REDEMPTION_STORE_REQUIRED');
    const scopes = ['all', scopeForStore(storeId)];
    for (const scope of scopes) for (const key of redemptionBucketKeys(item.redeemedAt)) {
      const path = JSON.stringify([scope, key]);
      const count = (counts.get(path) || 0) + item.quantity;
      if (!Number.isSafeInteger(count)) throw new Error('INVALID_REDEMPTION_COUNTER');
      counts.set(path, count);
    }
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}
function bucketRef(db, path) {
  const [scope, key] = JSON.parse(path);
  return db.collection(C.stats).doc(scope).collection('buckets').doc(key);
}
async function syncDashboardRedemptionStats(db, sourceId) {
  const meta = db.collection(C.meta).doc('default');
  try {
    return await db.runTransaction(async tx => {
      const sourceRef = db.collection(C.records).doc(sourceId), checkpointRef = db.collection(C.sources).doc(sourceId);
      const [source, checkpoint, gate] = await Promise.all([tx.get(sourceRef), tx.get(checkpointRef), tx.get(meta)]);
      if (!source.exists && !checkpoint.exists) return false;
      const data = source.data();
      const session = data ? await tx.get(db.collection(C.sessions).doc(data.visitSessionId || sourceId)) : null;
      const next = redemptionContributions(data, session?.data());
      const previous = checkpoint.data();
      if (previous && previous.version !== VERSION) throw new Error('INVALID_REDEMPTION_CHECKPOINT');
      const before = previous?.counts || {};
      if (JSON.stringify(before) === JSON.stringify(next) && checkpoint.exists) return false;
      const paths = [...new Set([...Object.keys(before), ...Object.keys(next)])].filter(key => (before[key] || 0) !== (next[key] || 0));
      if (paths.length > 450) throw new Error('REDEMPTION_BUCKET_LIMIT');
      const refs = paths.map(path => bucketRef(db, path));
      const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
      const values = paths.map((key, index) => {
        const value = (snapshots[index].data()?.count || 0) - (before[key] || 0) + (next[key] || 0);
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_REDEMPTION_COUNTER');
        return value;
      });
      const revision = (gate.data()?.revision || 0) + 1;
      if (!Number.isSafeInteger(revision)) throw new Error('INVALID_REDEMPTION_REVISION');
      refs.forEach((ref, index) => tx.set(ref, { count: values[index], version: VERSION }));
      tx.set(checkpointRef, { counts: next, version: VERSION });
      tx.set(meta, { version: VERSION, revision, updatedAt: new Date() }, { merge: true });
      return true;
    });
  } catch (error) {
    await meta.set({ ready: false, failure: 'projection-failed' }, { merge: true });
    throw error;
  }
}
module.exports = { collections: C, VERSION, redemptionBucketKeys, redemptionContributions, bucketRef, syncDashboardRedemptionStats };
