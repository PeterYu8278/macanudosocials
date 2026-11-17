const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { collections, syncRedemptionStats } = require('./redemptionStats.cjs');
const dashboard = require('./dashboardVisitStats.cjs');
const memberVisits = require('./visitMemberStats.cjs');
const dashboardRedemptions = require('./dashboardRedemptionStats.cjs');
const { syncRedemptionAdminMetadata } = require('./redemptionAdminMetadata.cjs');

initializeApp();
exports.syncRedemptionStats = onDocumentWritten({
  document: `${collections.records}/{sessionId}`,
  region: 'asia-southeast1',
  retry: true,
  maxInstances: 10,
}, event => syncRedemptionStats(getFirestore(), event.params.sessionId));

exports.syncDashboardVisitStats = onDocumentWritten({
  document: `${dashboard.collections.sessions}/{sessionId}`,
  region: 'asia-southeast1', retry: true, maxInstances: 10,
}, event => dashboard.syncDashboardVisitStats(getFirestore(), event.params.sessionId));

exports.syncDashboardRedemptionStats = onDocumentWritten({
  document: `${dashboardRedemptions.collections.records}/{sessionId}`,
  region: 'asia-southeast1', retry: true, maxInstances: 10,
}, event => dashboardRedemptions.syncDashboardRedemptionStats(getFirestore(), event.params.sessionId));

exports.syncDashboardRedemptionVisitScope = onDocumentWritten({
  document: `${dashboardRedemptions.collections.sessions}/{sessionId}`,
  region: 'asia-southeast1', retry: true, maxInstances: 10,
}, event => dashboardRedemptions.syncDashboardRedemptionStats(getFirestore(), event.params.sessionId));

exports.refreshDashboardVisitOccupancy = onSchedule({
  schedule: 'every 1 minutes', region: 'asia-southeast1',
  timeoutSeconds: 300, memory: '512MiB', maxInstances: 1,
}, () => dashboard.refreshDashboardVisitOccupancy(getFirestore()));

exports.syncVisitMemberStats = onDocumentWritten({
  document: `${memberVisits.collections.sessions}/{sessionId}`,
  region: 'asia-southeast1', retry: true, maxInstances: 10,
}, event => memberVisits.syncVisitMemberStats(getFirestore(), event.params.sessionId));

exports.initializeVisitMemberStats = onDocumentCreated({
  document: `${memberVisits.collections.users}/{userId}`,
  region: 'asia-southeast1', retry: true, maxInstances: 10,
}, event => memberVisits.initializeVisitMemberStats(getFirestore(), event.params.userId));

exports.syncRedemptionAdminMetadata = onDocumentWritten({
  document: `${collections.records}/{sessionId}`,
  region: 'asia-southeast1', retry: true, maxInstances: 10,
}, event => syncRedemptionAdminMetadata(getFirestore(), event.params.sessionId));

exports.syncVisitRedemptionAdminMetadata = onDocumentWritten({
  document: `${collections.sessions}/{sessionId}`,
  region: 'asia-southeast1', retry: true, maxInstances: 10,
}, event => {
  if (!event.data?.after.exists || event.data.before.data()?.storeId === event.data.after.data()?.storeId) return;
  return syncRedemptionAdminMetadata(getFirestore(), event.params.sessionId);
});
