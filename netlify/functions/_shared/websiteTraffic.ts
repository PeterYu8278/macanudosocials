import { createHash } from 'node:crypto';
import { FieldPath, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';
import { addSketch, emptyTrafficCounts, mergeSketch, estimateSketch, SKETCH_SIZE, trafficContext, trafficHour, TRAFFIC_EVENTS,
  type TrafficContext, type TrafficCounts, type TrafficEvent, type TrafficPage } from '../../../src/utils/websiteTraffic';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = (value: string) => createHash('sha256').update(value).digest().readUInt32BE(0);
export const sketch = (value?: string) => value ? [...Buffer.from(value, 'base64')] : Array(SKETCH_SIZE).fill(0);
const encode = (value: number[]) => Buffer.from(value).toString('base64');
export interface ServerTrafficEvent {
  id: string; type: TrafficEvent; page: TrafficPage | 'backend'; at: number; context: TrafficContext | null; loungeId: string;
}

/** Receipt and aggregate commit together. Replayed batches cannot increment twice. */
export async function persistWebsiteEvent(db: Firestore, event: ServerTrafficEvent) {
  const id = hash(event.id), hour = trafficHour(event.at), shard = digest(event.id) % 4;
  const receipt = db.collection(C.WEBSITE_EVENTS).doc(id);
  const aggregate = db.collection(C.WEBSITE_HOURS).doc(`${hour}_${shard}_${hash(event.loungeId).slice(0, 12)}`);
  const oncePerSession = event.type === 'engaged_visit' || event.type === 'registration_start';
  const guard = oncePerSession && event.context ? db.collection(C.WEBSITE_EVENTS)
    .doc(hash(`${event.type}:${event.context.session}`)) : receipt;
  return db.runTransaction(async tx => {
    const [prior, group] = await Promise.all([tx.get(receipt), tx.get(aggregate)]);
    const sessionGuard = guard.path === receipt.path ? prior : await tx.get(guard);
    if (prior.exists || sessionGuard.exists) return false;
    const data = group.data() || {}, counts: TrafficCounts = { ...emptyTrafficCounts(), ...data.counts };
    counts[event.type]++;
    const visitors = sketch(data.visitors), sessions = sketch(data.sessions);
    if ((TRAFFIC_EVENTS as readonly string[]).includes(event.type) && event.context) {
      addSketch(visitors, digest(event.context.visitor)); addSketch(sessions, digest(event.context.session));
    }
    const pages = { ...data.pages }, sources = { ...data.sources }, campaigns = { ...data.campaigns };
    pages[event.page] = { ...emptyTrafficCounts(), ...pages[event.page] };
    pages[event.page][event.type]++;
    const source = event.context?.source || 'unknown';
    sources[source] = { ...emptyTrafficCounts(), ...sources[source] };
    sources[source][event.type]++;
    if (event.context?.campaign) {
      let key = `${source} / ${event.context.medium || '-'} / ${event.context.campaign}`;
      if (!campaigns[key] && Object.keys(campaigns).length >= 32) key = 'other_campaigns';
      campaigns[key] = { ...emptyTrafficCounts(), ...campaigns[key] }; campaigns[key][event.type]++;
    }
    tx.set(aggregate, { hour, loungeId: event.loungeId, counts, pages, sources, campaigns, visitors: encode(visitors), sessions: encode(sessions),
      updatedAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(event.at + 400 * 86400000) });
    const saved = { type: event.type, page: event.page, at: Timestamp.fromMillis(event.at), loungeId: event.loungeId,
      source, medium: event.context?.medium || '', campaign: event.context?.campaign || '',
      expiresAt: Timestamp.fromMillis(event.at + (['registration_success', 'membership_activated'].includes(event.type) ? 400 : 90) * 86400000) };
    tx.set(receipt, saved);
    if (guard.path !== receipt.path) tx.set(guard, saved);
    return true;
  });
}

export function summarizeWebsiteHours(rows: any[]) {
  const counts = emptyTrafficCounts(), visitors = Array(SKETCH_SIZE).fill(0), sessions = Array(SKETCH_SIZE).fill(0);
  const trend: Record<string, TrafficCounts> = {}, pages: Record<string, TrafficCounts> = {}, sources: Record<string, TrafficCounts> = {};
  const campaigns: Record<string, TrafficCounts> = {};
  let updatedAt = 0;
  const sum = (to: TrafficCounts, from: TrafficCounts) => { for (const key of Object.keys(counts) as (keyof TrafficCounts)[]) to[key] += from?.[key] || 0; };
  for (const row of rows) {
    sum(counts, row.counts); mergeSketch(visitors, sketch(row.visitors)); mergeSketch(sessions, sketch(row.sessions));
    trend[row.hour] ||= emptyTrafficCounts(); sum(trend[row.hour], row.counts);
    for (const [key, values] of Object.entries(row.pages || {})) { pages[key] ||= emptyTrafficCounts(); sum(pages[key], values as TrafficCounts); }
    for (const [key, values] of Object.entries(row.sources || {})) { sources[key] ||= emptyTrafficCounts(); sum(sources[key], values as TrafficCounts); }
    for (const [name, values] of Object.entries(row.campaigns || {})) {
      const key = campaigns[name] || Object.keys(campaigns).length < 500 ? name : 'other_campaigns';
      campaigns[key] ||= emptyTrafficCounts(); sum(campaigns[key], values as TrafficCounts);
    }
    updatedAt = Math.max(updatedAt, row.updatedAt?.toMillis?.() || 0);
  }
  return { counts, visitors: estimateSketch(visitors), sessions: estimateSketch(sessions), trend, pages, sources, campaigns,
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null, uniqueMethod: 'hll-1024', timezone: 'Asia/Kuala_Lumpur' };
}

/** Backend facts only. Covers registrations and paid initial activations from every channel. */
export async function reconcileWebsiteConversions(db: Firestore) {
  const stateRef = db.collection(C.WEBSITE_JOBS).doc('conversions');
  const now = Date.now(), owner = hash(`${now}:${Math.random()}`), deadline = now + 18000;
  const lease = await db.runTransaction(async tx => {
    const prior = (await tx.get(stateRef)).data();
    if ((prior?.leaseUntil || 0) > now) return null;
    const through = prior?.through || now;
    const window = prior?.window || { start: through - 600000, end: now, kind: 0, cursorAt: null, cursorId: null };
    tx.set(stateRef, { through, window, owner, leaseUntil: now + 8 * 60000 }, { merge: true });
    return { window };
  });
  if (!lease) return { busy: true };
  const window = lease.window;
  let processed = 0, scanned = 0;
  const save = async (fields: Record<string, unknown>) => db.runTransaction(async tx => {
    const state = (await tx.get(stateRef)).data();
    if (state?.owner !== owner) throw new Error('CONVERSION_LEASE_LOST');
    tx.set(stateRef, fields, { merge: true });
  });
  try {
    while (window.kind < 2 && scanned < 300 && Date.now() < deadline) {
      const kind = window.kind === 0 ? 'registration_success' : 'membership_activated';
      const collection = kind === 'registration_success' ? C.USERS : C.MEMBERSHIP_FEE_RECORDS;
      const field = kind === 'registration_success' ? 'createdAt' : 'deductedAt';
      let query = db.collection(collection).where(field, '>=', Timestamp.fromMillis(window.start))
        .where(field, '<=', Timestamp.fromMillis(window.end)).orderBy(field).orderBy(FieldPath.documentId()).limit(50);
      if (window.cursorId) query = query.startAfter(Timestamp.fromMillis(window.cursorAt), window.cursorId);
      const result = await query.get();
      let lastProcessed: typeof result.docs[number] | undefined;
      for (const doc of result.docs) {
        if (scanned >= 300 || Date.now() >= deadline) break;
        scanned++;
        lastProcessed = doc;
        const data = doc.data(), uid = kind === 'registration_success' ? doc.id : data.userId;
        if (!uid || (kind === 'registration_success' && ['admin', 'storeAdmin', 'superAdmin', 'developer'].includes(data.role))
          || (kind === 'membership_activated' && (data.status !== 'paid' || data.renewalType !== 'initial'))) continue;
        const attribution = (await db.collection(C.WEBSITE_ATTRIBUTION).doc(uid).get()).data();
        const at = data[field]?.toMillis?.();
        if (!Number.isFinite(at)) continue;
        const context = attribution ? trafficContext(attribution, at) : null;
        await persistWebsiteEvent(db, { id: `${kind}:${uid}`, type: kind, page: context ? 'guest_landing' : 'backend', at,
          context, loungeId: kind === 'registration_success' ? context?.loungeId || 'unassigned' : data.storeId || 'unassigned' });
        processed++;
      }
      if (result.size < 50 && (!result.size || lastProcessed?.id === result.docs[result.docs.length - 1].id)) {
        window.kind++; window.cursorAt = null; window.cursorId = null;
      } else if (lastProcessed) { window.cursorAt = lastProcessed.data()[field].toMillis(); window.cursorId = lastProcessed.id; }
      await save({ window, updatedAt: Timestamp.now() });
    }
    await save({ ...(window.kind >= 2 ? { through: window.end, window: null } : { window }),
      leaseUntil: 0, updatedAt: Timestamp.now(), lastError: null });
    return { processed, pending: window.kind < 2 };
  } catch (error) {
    await save({ leaseUntil: 0, lastError: 'CONVERSION_REFRESH_FAILED', updatedAt: Timestamp.now() });
    throw error;
  }
}
