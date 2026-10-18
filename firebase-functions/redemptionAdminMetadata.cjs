const { collections } = require('./redemptionStats.cjs');

function deriveRedemptionAdminMetadata(source, session) {
  if (typeof session?.storeId !== 'string' || !session.storeId.trim()) throw new Error('SESSION_STORE_REQUIRED');
  if (!Array.isArray(source.redemptions)) throw new Error('INVALID_REDEMPTIONS');
  const statuses = source.redemptions.map(item => {
    if (!item || !['pending', 'completed'].includes(item.status || 'completed')) throw new Error('INVALID_REDEMPTION_STATUS');
    return item.status || 'completed';
  });
  return { storeId: session.storeId, adminStatuses: [...new Set(statuses)].sort() };
}

// Always reread current documents. Event payloads and backfill snapshots can be
// stale; a concurrent member request must force a transaction retry.
async function syncRedemptionAdminMetadata(db, sourceId) {
  try {
    return await db.runTransaction(async tx => {
    const sourceRef = db.collection(collections.records).doc(sourceId);
    const source = await tx.get(sourceRef);
    if (!source.exists) return { changed: false };
    const data = source.data();
    const sessionId = data.visitSessionId || sourceId;
    const session = await tx.get(db.collection(collections.sessions).doc(sessionId));
    if (!session.exists) throw new Error('ORPHAN_VISIT_SESSION');
    const metadata = deriveRedemptionAdminMetadata(data, session.data());
    if (data.storeId === metadata.storeId && JSON.stringify(data.adminStatuses) === JSON.stringify(metadata.adminStatuses)) return { changed: false };
    tx.update(sourceRef, metadata);
    return { changed: true };
    });
  } catch (error) {
    // An unprojectable legacy write must not leave an activated admin view
    // silently hiding that document. Keep the source untouched and fail closed.
    await db.collection('_adminVisitPaginationMeta').doc('default').set({ ready: false, invalidatedAt: new Date() }, { merge: true });
    throw error;
  }
}

module.exports = { deriveRedemptionAdminMetadata, syncRedemptionAdminMetadata };
