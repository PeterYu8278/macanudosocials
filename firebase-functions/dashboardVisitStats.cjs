const C = {
  sessions: 'visitSessions', sources: '_dashboardVisitStatsSources',
  stats: '_dashboardVisitStats', meta: '_dashboardVisitStatsMeta',
};
const VERSION = 1;
const OFFSET = 8 * 3600000;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const MAX_INTERVALS = 10000;
const MAX_SCOPES = 200;
function scopeForStore(id) {
  if (typeof id !== 'string' || !id || id.includes('/') || Buffer.byteLength(id, 'utf8') > 1000) throw new Error('INVALID_SUMMARY_STORE_ID');
  return `store_${id}`;
}
const metaRef = db => db.collection(C.meta).doc('default');
const bucketRef = (db, scope, key) => db.collection(C.stats).doc(scope).collection('buckets').doc(key);

function millis(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value?.toDate ? value.toDate() : value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function normalizeVisit(data, id) {
  if (!data) return null;
  // The old ordered query excluded documents without checkInAt and skipped invalid dates.
  const start = data.checkInAt === null ? 0 : millis(data.checkInAt);
  if (start === null) return null;
  const explicitEnd = data.checkOutAt ? millis(data.checkOutAt) : null;
  const open = explicitEnd === null && data.status === 'pending';
  const end = explicitEnd ?? (open ? Number.MAX_SAFE_INTEGER : data.updatedAt === null ? 0 : millis(data.updatedAt) ?? start);
  return { start, end, open, person: data.userId || id,
    storeId: typeof data.storeId === 'string' ? data.storeId : '' };
}

function counterKeys(source) {
  if (!source) return [];
  const day = new Date(source.start + OFFSET).toISOString().slice(0, 10);
  return [`daily_${day}`, `monthly_${day.slice(0, 7)}`, `yearly_${day.slice(0, 4)}`];
}

function sameSource(left, right) {
  if (!left || !right) return left === right;
  return ['start', 'end', 'open', 'person', 'storeId'].every(key => left[key] === right[key]);
}

async function syncDashboardVisitStats(db, id) {
  try {
    return await db.runTransaction(async tx => {
      const checkpointRef = db.collection(C.sources).doc(id);
      const [visit, checkpoint, metadata] = await Promise.all([
        tx.get(db.collection(C.sessions).doc(id)), tx.get(checkpointRef), tx.get(metaRef(db)),
      ]);
      const next = normalizeVisit(visit.data(), id);
      const before = checkpoint.data()?.source ?? null;
      if (checkpoint.exists && checkpoint.data().version !== VERSION) throw new Error('INVALID_VISIT_CHECKPOINT');
      if (sameSource(before, next)) return false;
      const deltas = new Map();
      for (const [source, delta] of [[before, -1], [next, 1]]) {
        if (!source) continue;
        const scopes = ['all', ...(source.storeId ? [scopeForStore(source.storeId)] : [])];
        for (const scope of scopes) for (const key of counterKeys(source)) {
          const path = `${scope}/${key}`;
          deltas.set(path, (deltas.get(path) || 0) + delta);
        }
      }
      const changes = [...deltas].filter(([, delta]) => delta !== 0);
      const refs = changes.map(([path]) => bucketRef(db, ...path.split('/')));
      const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
      const counts = changes.map(([, delta], index) => {
        const count = (snapshots[index].data()?.count ?? 0) + delta;
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('INVALID_VISIT_COUNTER');
        return count;
      });
      const revision = (metadata.data()?.revision ?? 0) + 1;
      if (!Number.isSafeInteger(revision)) throw new Error('INVALID_VISIT_REVISION');
      refs.forEach((ref, index) => tx.set(ref, { count: counts[index], version: VERSION }));
      // Keep flat interval fields indexed; the full checkpoint is private to the server.
      tx.set(checkpointRef, { source: next, start: next?.start ?? null, end: next?.end ?? null, version: VERSION });
      tx.set(metaRef(db), { version: VERSION, offsetMinutes: 480, revision }, { merge: true });
      return true;
    });
  } catch (error) {
    // A failed projection must not leave complete-looking legacy statistics available.
    await metaRef(db).set({ ready: false, failure: 'projection-failed' }, { merge: true });
    throw error;
  }
}

function occupancyBuckets(now) {
  const hour = Math.floor(now / HOUR) * HOUR;
  const day = Math.floor((now + OFFSET) / DAY) * DAY - OFFSET;
  const monday = day - ((new Date(day + OFFSET).getUTCDay() + 6) % 7) * DAY;
  return {
    hours24: Array.from({ length: 24 }, (_, i) => ({ start: hour - (23 - i) * HOUR, end: hour - (22 - i) * HOUR })),
    days7: Array.from({ length: 7 }, (_, i) => ({ start: monday + i * DAY, end: monday + (i + 1) * DAY })),
  };
}

function buildOccupancy(sources, now) {
  const buckets = occupancyBuckets(now);
  const scopes = new Map([['all', { hours24: buckets.hours24.map(() => new Set()), days7: buckets.days7.map(() => new Set()) }]]);
  for (const source of sources) {
    if (!source) continue;
    const keys = ['all', ...(source.storeId ? [scopeForStore(source.storeId)] : [])];
    for (const scope of keys) {
      if (!scopes.has(scope)) scopes.set(scope, { hours24: buckets.hours24.map(() => new Set()), days7: buckets.days7.map(() => new Set()) });
      if (scopes.size > MAX_SCOPES) throw new Error('OCCUPANCY_SCOPE_CAP');
      for (const period of ['hours24', 'days7']) buckets[period].forEach((bucket, index) => {
        if (bucket.start > now) return;
        const end = source.open ? now : source.end;
        if (source.start < bucket.end && end >= bucket.start) scopes.get(scope)[period][index].add(source.person);
      });
    }
  }
  return { buckets, scopes: new Map([...scopes].map(([scope, periods]) => [scope,
    Object.fromEntries(Object.entries(periods).map(([period, sets]) => [period, sets.map(people => people.size)]))])) };
}

async function refreshDashboardVisitOccupancy(db, now = Date.now()) {
  const metadata = await metaRef(db).get();
  const before = metadata.data();
  if (!before?.ready || before.version !== VERSION) return false;
  const buckets = occupancyBuckets(now);
  const window = buckets.hours24.at(-1).start;
  const weekStart = buckets.days7[0].start;
  if (before.occupancy?.revision === before.revision && before.occupancy?.window === window && before.occupancy?.weekStart === weekStart) {
    await db.runTransaction(async tx => {
      const current = await tx.get(metaRef(db));
      if (current.data()?.revision === before.revision && current.data()?.ready) {
        tx.set(metaRef(db), { workerCheckedAt: new Date(now) }, { merge: true });
      }
    });
    return true;
  }
  // Both inequalities matter: an old check-in can still overlap the entire window.
  const snapshot = await db.collection(C.sources)
    .where('end', '>=', Math.min(buckets.days7[0].start, buckets.hours24[0].start))
    .where('start', '<', buckets.days7.at(-1).end)
    .orderBy('end').orderBy('start').limit(MAX_INTERVALS + 1).get();
  let built;
  let failure = null;
  if (snapshot.size > MAX_INTERVALS) failure = 'interval-cap';
  else {
    try { built = buildOccupancy(snapshot.docs.map(doc => doc.data().source), now); }
    catch (error) { if (error.message !== 'OCCUPANCY_SCOPE_CAP') throw error; failure = 'scope-cap'; }
  }
  return db.runTransaction(async tx => {
    const current = (await tx.get(metaRef(db))).data();
    // Fence scans across source edits, bootstraps and concurrent workers.
    if (!current?.ready || current.revision !== before.revision || current.runId !== before.runId
      || millis(current.workerCheckedAt) > now) return false;
    const occupancy = { revision: before.revision, window, weekStart, ready: !failure, failure,
      scopes: built ? [...built.scopes.keys()] : [] };
    if (built) for (const [scope, values] of built.scopes) {
      tx.set(db.collection(C.stats).doc(scope), { version: VERSION, revision: before.revision, window, weekStart,
        hours24: values.hours24, days7: values.days7, asOf: new Date(now) });
    }
    tx.set(metaRef(db), { occupancy, workerCheckedAt: new Date(now) }, { merge: true });
    return !failure;
  });
}

module.exports = { collections: C, VERSION, MAX_INTERVALS, MAX_SCOPES, scopeForStore,
  normalizeVisit, sameSource, counterKeys, occupancyBuckets, buildOccupancy, syncDashboardVisitStats, refreshDashboardVisitOccupancy };
