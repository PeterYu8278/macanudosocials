const collections = {
  sessions: 'visitSessions', stats: '_visitMemberStats',
  sources: '_visitMemberStatsSources', meta: '_visitMemberStatsMeta', users: 'users',
};

function visitContribution(data) {
  if (!data) return { userId: null, completedHours: 0 };
  if (typeof data.userId !== 'string' || !data.userId || data.userId.includes('/')) {
    throw new Error('VISIT_OWNER_MISSING');
  }
  let completedHours = 0;
  if (data.status === 'completed' && data.checkInType !== 'daypass') {
    completedHours = data.durationHours ?? 0;
    if (typeof completedHours !== 'number' || !Number.isFinite(completedHours) || completedHours < 0) {
      throw new Error('INVALID_VISIT_HOURS');
    }
  }
  return { userId: data.userId, completedHours };
}

// Re-read the source inside the transaction: duplicate and out-of-order events
// converge, and admin edits, imports, deletes and ownership moves use the same path.
async function syncVisitMemberStats(db, sessionId) {
  return db.runTransaction(async tx => {
    const checkpointRef = db.collection(collections.sources).doc(sessionId);
    const [source, checkpoint] = await Promise.all([
      tx.get(db.collection(collections.sessions).doc(sessionId)), tx.get(checkpointRef),
    ]);
    const next = visitContribution(source.data());
    const before = checkpoint.data() || { userId: null, completedHours: 0 };
    if (checkpoint.exists && before.version !== 1) throw new Error('INVALID_VISIT_CHECKPOINT');
    if (!Number.isFinite(before.completedHours) || before.completedHours < 0) throw new Error('INVALID_VISIT_CHECKPOINT');
    if (checkpoint.exists && before.userId === next.userId && before.completedHours === next.completedHours) return false;
    const owners = [...new Set([before.userId, next.userId].filter(Boolean))];
    const refs = owners.map(id => db.collection(collections.stats).doc(id));
    const stats = await Promise.all(refs.map(ref => tx.get(ref)));
    const updates = owners.map((id, i) => {
      const old = stats[i].data();
      if (old && (old.version !== 1 || !Number.isFinite(old.completedHours) || old.completedHours < 0)) {
        throw new Error('INVALID_VISIT_COUNTER');
      }
      const value = (old?.completedHours ?? 0)
        + (next.userId === id ? next.completedHours : 0)
        - (before.userId === id ? before.completedHours : 0);
      if (!Number.isFinite(value) || value < -1e-8) throw new Error('INVALID_VISIT_COUNTER');
      return { userId: id, version: 1, completedHours: Math.max(0, value), updatedAt: new Date() };
    });
    refs.forEach((ref, i) => tx.set(ref, updates[i]));
    tx.set(checkpointRef, { ...next, version: 1, updatedAt: new Date() });
    return true;
  });
}

async function reconcileVisitMemberStats(db, userId, apply = false) {
  return db.runTransaction(async tx => {
    const sources = await tx.get(db.collection(collections.sources).where('userId', '==', userId));
    let completedHours = 0;
    for (const source of sources.docs) {
      const data = source.data();
      if (data.version !== 1 || !Number.isFinite(data.completedHours) || data.completedHours < 0) {
        throw new Error('INVALID_VISIT_CHECKPOINT');
      }
      completedHours += data.completedHours;
    }
    if (!Number.isFinite(completedHours)) throw new Error('INVALID_VISIT_COUNTER');
    if (apply) tx.set(db.collection(collections.stats).doc(userId), {
      userId, version: 1, completedHours, updatedAt: new Date(),
    });
    return { completedHours };
  });
}

// Register on users/{userId} creation with retry enabled. A missing older summary
// is corruption, not evidence of zero. Query reads also conflict with concurrent visits.
async function initializeVisitMemberStats(db, userId) {
  return db.runTransaction(async tx => {
    const ref = db.collection(collections.stats).doc(userId);
    const [user, stats, meta, visits, checkpoints] = await Promise.all([
      tx.get(db.collection(collections.users).doc(userId)), tx.get(ref),
      tx.get(db.collection(collections.meta).doc('default')),
      tx.get(db.collection(collections.sessions).where('userId', '==', userId).limit(1)),
      tx.get(db.collection(collections.sources).where('userId', '==', userId).limit(1)),
    ]);
    if (!user.exists || stats.exists) return false;
    const gate = meta.data();
    if (!gate?.ready || gate.version !== 1) throw new Error('VISIT_STATS_NOT_READY');
    const startedAt = gate.startedAt?.toDate?.() || gate.startedAt;
    const createdAt = user.createTime?.toDate?.();
    if (!(startedAt instanceof Date) || !createdAt || createdAt <= startedAt || visits.size || checkpoints.size) {
      throw new Error('VISIT_STATS_INITIALIZATION_REQUIRES_RECONCILIATION');
    }
    tx.set(ref, { userId, version: 1, completedHours: 0, updatedAt: new Date() });
    return true;
  });
}

module.exports = { collections, visitContribution, syncVisitMemberStats, reconcileVisitMemberStats, initializeVisitMemberStats };
