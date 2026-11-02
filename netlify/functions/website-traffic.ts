import type { Config } from '@netlify/functions';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections';
import { parseTrafficEvent, trafficDay, type TrafficInput } from '../../src/utils/websiteTraffic';
import { persistWebsiteEvent, summarizeWebsiteHours } from './_shared/websiteTraffic';

const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const cache = new Map<string, { until: number; result: unknown }>();
export default async function handler(request: Request) {
  if (!['GET', 'POST'].includes(request.method)) return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    if (!getApps().length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) return json(503, { error: 'UNAVAILABLE' });
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    }
    const db = getFirestore();
    if (request.method === 'POST') {
      // Avoid a second, unthrottled ingestion URL via the default function alias.
      if (new URL(request.url).pathname !== '/api/website-traffic') return json(404, { error: 'NOT_FOUND' });
      if (process.env.CONTEXT && process.env.CONTEXT !== 'production') return json(200, { accepted: 0, disabled: true });
      if (process.env.WEBSITE_TRAFFIC_ENABLED === 'false') return json(200, { accepted: 0, disabled: true });
      if (!['https://macanudosocials.com', 'https://www.macanudosocials.com'].includes(request.headers.get('origin') || '')) return json(403, { error: 'ORIGIN_DENIED' });
      if (/bot|crawler|spider|headless|preview/i.test(request.headers.get('user-agent') || '')) return json(200, { accepted: 0 });
      if (Number(request.headers.get('content-length') || 0) > 24000) return json(413, { error: 'TOO_LARGE' });
      const body = await request.text(); if (body.length > 24000) return json(413, { error: 'TOO_LARGE' });
      let input; try { input = JSON.parse(body); } catch { return json(400, { error: 'INVALID_JSON' }); }
      if (!Array.isArray(input.events) || !input.events.length || input.events.length > 20) return json(400, { error: 'INVALID_EVENTS' });
      const events = input.events.map((e: unknown) => parseTrafficEvent(e));
      if (events.some((e: TrafficInput | null) => !e)) return json(400, { error: 'INVALID_EVENTS' });
      let accepted = 0;
      for (const event of events as TrafficInput[]) {
        if (await persistWebsiteEvent(db, { ...event, context: event, loungeId: event.loungeId })) accepted++;
      }
      return json(200, { accepted });
    }
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return json(401, { error: 'UNAUTHENTICATED' });
    let uid; try { uid = (await getAuth().verifyIdToken(token)).uid; } catch { return json(401, { error: 'UNAUTHENTICATED' }); }
    const role = (await db.collection(C.USERS).doc(uid).get()).data()?.role;
    if (!['developer', 'superAdmin', 'admin'].includes(role)) return json(403, { error: 'FORBIDDEN' });
    const params = new URL(request.url).searchParams;
    const end = params.get('end') || trafficDay(Date.now()), start = params.get('start') || end;
    const startMs = Date.parse(start + 'T00:00:00+08:00'), endMs = Date.parse(end + 'T00:00:00+08:00');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)
      || !Number.isFinite(startMs) || !Number.isFinite(endMs) || trafficDay(startMs) !== start || trafficDay(endMs) !== end
      || endMs < startMs || endMs - startMs > 30 * 86400000) return json(400, { error: 'INVALID_RANGE' });
    const lounge = params.get('lounge') || 'all', key = `${start}/${end}/${lounge}`;
    const prior = cache.get(key); if (prior && prior.until > Date.now()) return json(200, prior.result);
    const snapshot = await db.collection(C.WEBSITE_HOURS).where('hour', '>=', start + 'T00')
      .where('hour', '<=', end + 'T23').limit(4097).get();
    const rows = snapshot.docs.slice(0, 4096).map(d => d.data()).filter(d => lounge === 'all' || d.loungeId === lounge);
    const job = (await db.collection(C.WEBSITE_JOBS).doc('conversions').get()).data();
    const result = { ...summarizeWebsiteHours(rows), start, end, truncated: snapshot.size > 4096,
      lounges: [...new Set(snapshot.docs.map(d => d.data().loungeId))],
      conversionUpdatedAt: job?.through ? new Date(job.through).toISOString() : null,
      conversionError: !!job?.lastError || (!!job?.window && Date.now() - job.window.end > 600000), enabled: process.env.WEBSITE_TRAFFIC_ENABLED !== 'false' };
    if (cache.size >= 100) cache.clear(); cache.set(key, { until: Date.now() + 60000, result });
    return json(200, result);
  } catch { return json(503, { error: 'TRAFFIC_UNAVAILABLE' }); }
}
export const config: Config = { path: '/api/website-traffic', rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
