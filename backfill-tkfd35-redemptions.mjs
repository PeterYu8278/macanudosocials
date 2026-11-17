/**
 * One-time backfill: Hee Chee Ming (TKFD35) redemptions
 * 15 Sept 2026 – 30 Oct 2026
 *
 * Usage:
 *   node --env-file=".env.local" backfill-tkfd35-redemptions.mjs
 *   node --env-file=".env.local" backfill-tkfd35-redemptions.mjs --write
 *
 * Without --write the script is a dry-run: it prints what it would do.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

// ── Config ────────────────────────────────────────────────────────────────────

const MEMBER_ID   = 'TKFD35';
const CIGAR_NAME  = 'OSCAR VALLADARES PLAN B HABANO TORO';
const CIGAR_SKU   = 'OVPBHTOR20';   // used for fallback search
const CIGAR_ID    = 'bY5W8jWn3JUx7e1QPpgV'; // resolved from Firestore
const REDEEMED_BY = 'backfill-admin'; // recorded as operator

/** Receipts extracted from photos.
 *  checkIn = timestamp on the first receipt for that day (MYT = UTC+8).
 *  cigars  = number of cigars (uses default CIGAR_ID for all).
 *  items   = per-redemption overrides [{cigarSku, cigarName}] — overrides default cigar.
 *  Rule: first redemption at checkIn, second at checkIn + 1 hr. */
const BACKFILL_DAYS = [
  // Sept 15: two different cigars on same day
  // Nov 6 visit 1 (13:23)
  { checkIn: '2026-11-06T13:23:00+08:00', receipts: ['RCT-0000643','RCT-0000644'], items: [
    { cigarSku: 'EES', cigarName: 'ESTELI EL SUELO' },
    { cigarSku: 'EES', cigarName: 'ESTELI EL SUELO' },
  ]},
  // Nov 6 visit 2 (15:30)
  { checkIn: '2026-11-06T15:30:00+08:00', receipts: ['RCT-0000649','RCT-0000652'], items: [
    { cigarSku: 'EES', cigarName: 'ESTELI EL SUELO' },
    { cigarSku: 'EES', cigarName: 'ESTELI EL SUELO' },
  ]},
  // Sept 15: two different cigars on same day
  { checkIn: '2026-09-15T13:15:10+08:00', receipts: ['RCT-0000304','RCT-0000306'], items: [
    { cigarSku: 'BLE15AJFROB', cigarName: 'BLEND 15 AJ FERNANDEZ ROBUSTO' },
    { cigarSku: 'PFROB',       cigarName: 'PRIZE FIGHTER ROBUSTO' },
  ]},
  { checkIn: '2026-09-18T11:51:12+08:00', cigars: 2, receipts: ['RCT-0000317','RCT-0000321'] },
  { checkIn: '2026-09-23T11:29:43+08:00', cigars: 2, receipts: ['RCT-0000348','RCT-0000349'] },
  { checkIn: '2026-09-24T14:28:41+08:00', cigars: 2, receipts: ['RCT-0000365','RCT-0000367'] },
  { checkIn: '2026-09-29T13:43:01+08:00', cigars: 1, receipts: ['RCT-0000407'] },
  { checkIn: '2026-10-02T11:18:15+08:00', cigars: 2, receipts: ['RCT-0000431','RCT-0000433'] },
  { checkIn: '2026-10-13T13:32:27+08:00', cigars: 1, receipts: ['RCT-0000503'] },
  { checkIn: '2026-10-15T14:03:31+08:00', cigars: 2, receipts: ['RCT-0000523','RCT-0000527'] },
  { checkIn: '2026-10-19T11:58:07+08:00', cigars: 2, receipts: ['RCT-0000548','RCT-0000549'] },
  { checkIn: '2026-10-30T11:14:02+08:00', cigars: 1, receipts: ['RCT-0000597'] },
];

const DRY_RUN = !process.argv.includes('--write');

// ── Helpers ───────────────────────────────────────────────────────────────────

const rand = () => `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

/** Return midnight (start) and 23:59:59.999 (end) for a given Date in UTC. */
function dayBounds(d) {
  const start = new Date(d);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Init Firebase Admin — accept env var OR a local JSON file (--sa-file path/to/sa.json)
  let svcAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!svcAccount) {
    const saFlagIndex = process.argv.indexOf('--sa-file');
    const saPath = saFlagIndex !== -1 ? process.argv[saFlagIndex + 1] : 'firebase-service-account.json';
    try {
      const { readFileSync } = await import('fs');
      svcAccount = readFileSync(saPath, 'utf8');
      console.log(`   Using service account file: ${saPath}`);
    } catch {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT env var not set and no service account file found.\n` +
        `Options:\n` +
        `  1. Place firebase-service-account.json in the project root\n` +
        `  2. Pass --sa-file path/to/serviceAccount.json\n` +
        `  3. Set FIREBASE_SERVICE_ACCOUNT env var to the JSON string`
      );
    }
  }
  if (!getApps().length) initializeApp({ credential: cert(JSON.parse(svcAccount)) });
  const db = getFirestore();

  // 1. Resolve userId from memberId
  console.log(`\n🔍 Looking up member ${MEMBER_ID}…`);
  const userSnap = await db.collection('users')
    .where('memberId', '==', MEMBER_ID)
    .limit(1).get();
  if (userSnap.empty) throw new Error(`No user found with memberId ${MEMBER_ID}`);
  const userDoc = userSnap.docs[0];
  const userId   = userDoc.id;
  const userName = userDoc.data().displayName || userDoc.data().name || '';
  console.log(`   ✅ userId=${userId}  name=${userName}`);

  // 2. Resolve cigarId
  console.log(`\n🔍 Looking up cigar "${CIGAR_NAME}"…`);
  let cigarId = CIGAR_ID; // pre-resolved
  let resolvedCigarName = CIGAR_NAME;
  if (cigarId) { console.log(`   ✅ cigarId=${cigarId} (pre-resolved)`); }

  if (!cigarId) {
  // Try exact name match first
  const cigarByName = await db.collection('cigars')
    .where('name', '==', CIGAR_NAME).limit(1).get();
  if (!cigarByName.empty) {
    cigarId = cigarByName.docs[0].id;
  }

  // Try alternate SKU field names
  if (!cigarId) {
    for (const skuField of ['sku', 'code', 'itemCode', 'productCode', 'skuCode']) {
      const snap = await db.collection('cigars').where(skuField, '==', CIGAR_SKU).limit(1).get();
      if (!snap.empty) { cigarId = snap.docs[0].id; resolvedCigarName = snap.docs[0].data().name || CIGAR_NAME; break; }
    }
  }

  // Fallback: scan all cigars for a partial name match
  if (!cigarId) {
    console.log(`   Exact match not found — scanning all cigars for partial name match…`);
    const allCigars = await db.collection('cigars').get();
    const keywords = ['Plan B', 'Oscar Valladares', CIGAR_SKU.toLowerCase()];
    const candidates = allCigars.docs.filter(d => {
      const data = d.data();
      const haystack = JSON.stringify(data).toLowerCase();
      return keywords.some(k => haystack.includes(k.toLowerCase()));
    });
    if (candidates.length === 1) {
      cigarId = candidates[0].id;
      resolvedCigarName = candidates[0].data().name || CIGAR_NAME;
      console.log(`   Found via partial match: "${resolvedCigarName}" (id=${cigarId})`);
    } else if (candidates.length > 1) {
      console.log(`   Multiple candidates found — please pick one:`);
      candidates.forEach((d, i) => console.log(`   [${i}] id=${d.id}  name=${d.data().name}  sku=${d.data().sku || d.data().code || ''}`));
      throw new Error(`Ambiguous cigar match — set CIGAR_ID manually in the script`);
    }
  }

  if (!cigarId) {
    // Last resort: list all cigars so the user can identify the right one
    console.log(`\n   ⚠️  Could not find cigar. All cigars in the collection:`);
    const allCigars = await db.collection('cigars').get();
    allCigars.docs.forEach(d => console.log(`   id=${d.id}  name=${d.data().name}  sku=${d.data().sku || d.data().code || ''}`));
    throw new Error(`Cigar not found: "${CIGAR_NAME}" / SKU ${CIGAR_SKU}. See list above and set CIGAR_ID manually.`);
  }
  console.log(`   ✅ cigarId=${cigarId}`);
  } // end if (!cigarId)

  // 3. Process each day
  const cigarCache = {}; // SKU/name → {id, name}
  let totalRedemptions = 0, errors = 0;

  for (const day of BACKFILL_DAYS) {
    const checkInDate = new Date(day.checkIn);
    const { start, end } = dayBounds(checkInDate);
    const dateLabel = checkInDate.toISOString().split('T')[0];

    const dayCount = day.items ? day.items.length : (day.cigars ?? 0);
    console.log(`\n📅 ${dateLabel}  (${dayCount} cigar${dayCount > 1 ? 's' : ''})  receipts: ${day.receipts.join(', ')}`);

    // Find the visit session for this user on this day.
    // Query by userId only (no composite index needed), filter date in memory.
    const allUserSess = await db.collection('visitSessions')
      .where('userId', '==', userId).get();

    const daySessions = allUserSess.docs.filter(d => {
      const ts = d.data().checkInAt;
      if (!ts) return false;
      const ms = ts.toMillis();
      return ms >= start.getTime() && ms <= end.getTime();
    });

    if (daySessions.length === 0) {
      console.log(`   ⚠️  No visit session found — skipping`);
      errors++;
      continue;
    }

    // Pick the session closest to the receipt check-in time
    let best = daySessions[0];
    let bestDiff = Math.abs(best.data().checkInAt.toMillis() - checkInDate.getTime());
    for (const d of daySessions.slice(1)) {
      const diff = Math.abs(d.data().checkInAt.toMillis() - checkInDate.getTime());
      if (diff < bestDiff) { best = d; bestDiff = diff; }
    }

    const visitSessionId = best.id;
    const sessData = best.data();
    const storeId   = sessData.storeId || '';
    console.log(`   🗂  visitSessionId=${visitSessionId}  checkInAt=${sessData.checkInAt.toDate().toISOString()}`);

    // Check if redemptions already exist for this session
    const rdocRef = db.collection('redemptionRecords').doc(visitSessionId);
    const rdocSnap = await rdocRef.get();
    const existingRedemptions = rdocSnap.exists
      ? (rdocSnap.data().redemptions || []) : [];
    if (existingRedemptions.length >= dayCount) {
      console.log(`   ℹ️  Already has ${existingRedemptions.length} redemption(s) — skipping`);
      continue;
    }
    const startIndex = existingRedemptions.length;
    if (startIndex > 0) {
      console.log(`   ⚠️  Partial: ${startIndex}/${dayCount} — adding ${dayCount - startIndex} missing`);
    }

    // Build redemption items (start from startIndex to avoid duplicating existing)
    const items = [];
    const perItemList = day.items ?? Array.from({ length: day.cigars ?? 0 }, () => ({}));
    for (let i = startIndex; i < perItemList.length; i++) {
      const override = perItemList[i];
      // Resolve cigar for this item — use override if provided, else default
      let itemCigarId = cigarId, itemCigarName = resolvedCigarName;
      if (override.cigarSku || override.cigarName) {
        // Look up from Firestore (cache by SKU to avoid repeat queries)
        const cacheKey = override.cigarSku || override.cigarName;
        if (!cigarCache[cacheKey]) {
          let found = null;
          if (override.cigarSku) {
            for (const skuField of ['sku', 'code', 'itemCode', 'productCode', 'skuCode']) {
              const s = await db.collection('cigars').where(skuField, '==', override.cigarSku).limit(1).get();
              if (!s.empty) { found = s.docs[0]; break; }
            }
          }
          if (!found && override.cigarName) {
            const s = await db.collection('cigars').where('name', '==', override.cigarName).limit(1).get();
            if (!s.empty) found = s.docs[0];
          }
          if (!found) {
            // Partial scan fallback
            const all = await db.collection('cigars').get();
            const kw = [override.cigarSku, override.cigarName].filter(Boolean);
            const hits = all.docs.filter(d => kw.some(k => JSON.stringify(d.data()).toLowerCase().includes(k.toLowerCase())));
            if (hits.length === 1) found = hits[0];
            else if (hits.length > 1) {
              console.log(`   Multiple candidates for "${cacheKey}":`);
              hits.forEach(d => console.log(`     id=${d.id}  name=${d.data().name}`));
              throw new Error(`Ambiguous cigar "${cacheKey}" — set id manually`);
            }
          }
          if (!found) throw new Error(`Cigar not found: "${cacheKey}"`);
          cigarCache[cacheKey] = { id: found.id, name: found.data().name || cacheKey };
          console.log(`   🔍 Resolved "${cacheKey}" → id=${found.id}  name=${found.data().name}`);
        }
        itemCigarId   = cigarCache[cacheKey].id;
        itemCigarName = cigarCache[cacheKey].name;
      }

      const redeemedAt = new Date(checkInDate.getTime() + i * 60 * 60 * 1000); // +1hr each
      const dayKey  = redeemedAt.toISOString().split('T')[0];
      const hourKey = redeemedAt.toISOString().slice(0, 13); // YYYY-MM-DDTHH
      items.push({
        id: rand(),
        userId,
        userName,
        cigarId: itemCigarId,
        cigarName: itemCigarName,
        quantity: 1,
        status: 'completed',
        dayKey,
        hourKey,
        redemptionIndex: i + 1,
        redeemedAt: Timestamp.fromDate(redeemedAt),
        redeemedBy: REDEEMED_BY,
        createdAt: Timestamp.fromDate(redeemedAt),
      });
      console.log(`   ${DRY_RUN ? '[DRY]' : '✍️ '} Redemption #${i + 1}: ${redeemedAt.toISOString()}  [${itemCigarName}]`);
    }
    totalRedemptions += items.length;

    if (DRY_RUN) continue;

    // Write: redemptionRecords document
    const now = Timestamp.now();
    if (rdocSnap.exists) {
      await rdocRef.update({
        visitSessionId,
        userId,
        userName,
        adminStatuses: ['completed'],
        redemptions: FieldValue.arrayUnion(...items),
        updatedAt: now,
      });
    } else {
      await rdocRef.set({
        visitSessionId,
        userId,
        userName,
        ...(storeId ? { storeId } : {}),
        adminStatuses: ['completed'],
        redemptions: items,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Write: visitSessions.redemptions array
    const sessionItems = items.map(item => ({
      recordId: item.id,
      cigarId: item.cigarId,
      cigarName: item.cigarName,
      quantity: 1,
      redeemedAt: item.redeemedAt,
      redeemedBy: REDEEMED_BY,
    }));
    await db.collection('visitSessions').doc(visitSessionId).update({
      redemptions: FieldValue.arrayUnion(...sessionItems),
      updatedAt: now,
    });
    console.log(`   ✅ Written`);
  }

  console.log(`\n${'─'.repeat(60)}`);
  if (DRY_RUN) {
    console.log(`DRY RUN complete.`);
    console.log(`Would create ${totalRedemptions} redemption records across ${BACKFILL_DAYS.length - errors} sessions.`);
    console.log(`Skipped (no session found): ${errors}`);
    console.log(`\nRun with --write to apply.\n`);
  } else {
    console.log(`Backfill complete: ${totalRedemptions} redemptions written, ${errors} day(s) skipped.\n`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
