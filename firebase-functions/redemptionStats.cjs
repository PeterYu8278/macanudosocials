const collections = {
  records: 'redemptionRecords', sessions: 'visitSessions',
  stats: '_redemptionStats', sources: '_redemptionStatsSources', meta: '_redemptionStatsMeta',
};

function countRedemptions(items, userId) {
  const totals = { completedQuantity: 0, pendingQuantity: 0 };
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || item.isDayPass || item.type === 'referral_reward' || item.cigarId === 'referral_reward'
      || (item.userId && item.userId !== userId) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0) continue;
    const status = item.status || 'completed';
    if (status === 'completed') totals.completedQuantity += item.quantity;
    if (status === 'pending') totals.pendingQuantity += item.quantity;
  }
  return totals;
}

// Read current source state instead of event deltas: retries and out-of-order events
// converge to the latest record. Checkpoint and all affected counters commit together.
async function syncRedemptionStats(db, sourceId) {
  return db.runTransaction(async tx => {
    const sourceRef = db.collection(collections.records).doc(sourceId);
    const checkpointRef = db.collection(collections.sources).doc(sourceId);
    const [source, checkpoint] = await Promise.all([tx.get(sourceRef), tx.get(checkpointRef)]);
    const data = source.data();
    let userId = typeof data?.userId === 'string' && data.userId ? data.userId : null;
    if (data && !userId) {
      const session = await tx.get(db.collection(collections.sessions).doc(data.visitSessionId || sourceId));
      userId = session.data()?.userId || null;
    }
    // Do not publish a complete-looking count when a legacy document cannot be attributed.
    if (data && !userId) throw new Error('REDEMPTION_OWNER_MISSING');
    const next = { userId, ...countRedemptions(data?.redemptions, userId) };
    const before = checkpoint.data() || { userId: null, completedQuantity: 0, pendingQuantity: 0 };
    if (checkpoint.exists && ['userId', 'completedQuantity', 'pendingQuantity'].every(key => before[key] === next[key])) return false;
    const owners = [...new Set([before.userId, next.userId].filter(Boolean))];
    const refs = owners.map(id => db.collection(collections.stats).doc(id));
    const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
    const now = new Date();
    const updates = owners.map((id, index) => {
      const old = snapshots[index].data() || { completedQuantity: 0, pendingQuantity: 0 };
      const update = { userId: id, version: 1, updatedAt: now };
      for (const field of ['completedQuantity', 'pendingQuantity']) {
        const value = old[field] + (next.userId === id ? next[field] : 0) - (before.userId === id ? before[field] : 0);
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_REDEMPTION_COUNTER');
        update[field] = value;
      }
      return update;
    });
    refs.forEach((ref, index) => tx.set(ref, updates[index]));
    tx.set(checkpointRef, { ...next, version: 1, updatedAt: now });
    return true;
  });
}

// Also usable as an independent consistency check/repair after initial synchronization.
async function reconcileUserStats(db, userId, apply = false) {
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(db.collection(collections.sources).where('userId', '==', userId));
    const totals = { completedQuantity: 0, pendingQuantity: 0 };
    for (const doc of snapshot.docs) for (const key of Object.keys(totals)) totals[key] += doc.data()[key];
    if (Object.values(totals).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('INVALID_REDEMPTION_COUNTER');
    if (apply) tx.set(db.collection(collections.stats).doc(userId), { userId, ...totals, version: 1, updatedAt: new Date() });
    return totals;
  });
}
module.exports = { collections, countRedemptions, syncRedemptionStats, reconcileUserStats };
