/**
 * Fix: move AJF NEW WORLD redemption from orphan session → main session (17 Aug 2026)
 *
 * Usage:
 *   node --env-file=".env.local" fix-aug17-orphan.mjs          (dry-run)
 *   node --env-file=".env.local" fix-aug17-orphan.mjs --write
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const sa = JSON.parse(readFileSync('firebase-service-account.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const DRY_RUN = !process.argv.includes('--write');

const ORPHAN_SESSION_ID = 'legacy_orphan_6dd8aac095c8c4a5acd2314b66f4101a';
const MAIN_SESSION_ID   = 'legacy_d03f2abe3a4cb70694215a25763649dc';
const AJF_ID            = 'legacy_b5a265a08470513f159081a07c729f02'; // id in redemptionRecords

const toDate = (v) => {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v._seconds != null) return new Date(v._seconds * 1000);
  return null;
};
const fmt = (d) => d?.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }) ?? 'null';

console.log(DRY_RUN ? '🔍 DRY RUN\n' : '✍️  WRITE MODE\n');

// ── Read all four docs ────────────────────────────────────────────────────────

const [orphanSessionSnap, mainSessionSnap, orphanRdocSnap, mainRdocSnap] = await Promise.all([
  db.collection('visitSessions').doc(ORPHAN_SESSION_ID).get(),
  db.collection('visitSessions').doc(MAIN_SESSION_ID).get(),
  db.collection('redemptionRecords').doc(ORPHAN_SESSION_ID).get(),
  db.collection('redemptionRecords').doc(MAIN_SESSION_ID).get(),
]);

const orphanSession = orphanSessionSnap.data() ?? {};
const mainSession   = mainSessionSnap.data() ?? {};
const orphanRdoc    = orphanRdocSnap.data() ?? {};
const mainRdoc      = mainRdocSnap.data() ?? {};

// ── Locate AJF in both arrays ─────────────────────────────────────────────────

// visitSession.redemptions uses `recordId`
const ajfOnSession = (orphanSession.redemptions ?? []).find(r => r.recordId === AJF_ID);
if (!ajfOnSession) { console.error('❌ AJF not found in orphan visitSession.redemptions'); process.exit(1); }

// redemptionRecords.redemptions uses `id`
const ajfOnRdoc = (orphanRdoc.redemptions ?? []).find(r => r.id === AJF_ID);
if (!ajfOnRdoc) { console.error('❌ AJF not found in orphan redemptionRecords.redemptions'); process.exit(1); }

console.log('✅ Found AJF in both docs:');
console.log('   cigarName  :', ajfOnSession.cigarName);
console.log('   redeemedAt :', fmt(toDate(ajfOnSession.redeemedAt)));

// ── Build new arrays ──────────────────────────────────────────────────────────

// visitSession.redemptions
const orphanSessionRedNew = (orphanSession.redemptions ?? []).filter(r => r.recordId !== AJF_ID);
const mainSessionRedNew   = [...(mainSession.redemptions ?? []), ajfOnSession];

// redemptionRecords.redemptions
const orphanRdocRedNew = (orphanRdoc.redemptions ?? []).filter(r => r.id !== AJF_ID);
const mainRdocRedNew   = [...(mainRdoc.redemptions ?? []), ajfOnRdoc];

// Sort main by redeemedAt ascending
const sortByRedeemedAt = (arr) => [...arr].sort((a, b) => {
  const ta = toDate(a.redeemedAt)?.getTime() ?? 0;
  const tb = toDate(b.redeemedAt)?.getTime() ?? 0;
  return ta - tb;
});

const mainSessionRedSorted = sortByRedeemedAt(mainSessionRedNew);
const mainRdocRedSorted    = sortByRedeemedAt(mainRdocRedNew);

// ── Preview ───────────────────────────────────────────────────────────────────

console.log('\n── Planned changes ──────────────────────────────────────────────');
console.log(`visitSessions/${ORPHAN_SESSION_ID}: redemptions ${(orphanSession.redemptions ?? []).length} → ${orphanSessionRedNew.length}`);
console.log(`visitSessions/${MAIN_SESSION_ID}:   redemptions ${(mainSession.redemptions ?? []).length} → ${mainSessionRedSorted.length}`);
console.log(`redemptionRecords/${ORPHAN_SESSION_ID}: ${(orphanRdoc.redemptions ?? []).length} → ${orphanRdocRedNew.length}`);
console.log(`redemptionRecords/${MAIN_SESSION_ID}:   ${(mainRdoc.redemptions ?? []).length} → ${mainRdocRedSorted.length}`);

console.log('\nMain session final order:');
for (const r of mainRdocRedSorted) {
  console.log('  ', fmt(toDate(r.redeemedAt)), '|', r.cigarName);
}

if (DRY_RUN) {
  console.log('\n── DRY RUN complete. Run with --write to apply. ─────────────────');
  process.exit(0);
}

// ── Apply in a transaction ────────────────────────────────────────────────────

await db.runTransaction(async (tx) => {
  tx.update(db.collection('visitSessions').doc(ORPHAN_SESSION_ID),    { redemptions: orphanSessionRedNew });
  tx.update(db.collection('visitSessions').doc(MAIN_SESSION_ID),      { redemptions: mainSessionRedSorted });
  tx.update(db.collection('redemptionRecords').doc(ORPHAN_SESSION_ID), { redemptions: orphanRdocRedNew });
  tx.update(db.collection('redemptionRecords').doc(MAIN_SESSION_ID),   { redemptions: mainRdocRedSorted });
});

console.log('\n✅ Done. AJF NEW WORLD 已移入 17 Aug 12:08–15:48 主 session。');
console.log('   主 session 现有 3 条兑换记录。');
