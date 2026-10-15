const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { collections, syncRedemptionStats } = require('./redemptionStats.cjs');

initializeApp();
exports.syncRedemptionStats = onDocumentWritten({
  document: `${collections.records}/{sessionId}`,
  region: 'asia-southeast1',
  retry: true,
  maxInstances: 10,
}, event => syncRedemptionStats(getFirestore(), event.params.sessionId));
