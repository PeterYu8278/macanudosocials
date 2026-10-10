import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { GLOBAL_COLLECTIONS } from '../../src/config/globalCollections';
import { persistMetrics, type MetricRow } from './_shared/firestoreMonitoring';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
export default async function handler(request: Request) {
  try {
    if (!['GET', 'POST'].includes(request.method)) return json(405, { error: 'METHOD_NOT_ALLOWED' });
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return json(401, { error: 'UNAUTHENTICATED' });
    if (!getApps().length) {
      if (!process.env.FIREBASE_SERVICE_ACCOUNT) return json(503, { error: 'SERVICE_UNAVAILABLE' });
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    }
    let uid: string;
    try { uid = (await getAuth().verifyIdToken(token)).uid; }
    catch { return json(401, { error: 'UNAUTHENTICATED' }); }
    const db = getFirestore();
    if (request.method === 'POST') {
      if (process.env.FIRESTORE_MONITORING_ENABLED === 'false') return json(200, { disabled: true });
      const text = await request.text();
      if (text.length > 32_000) return json(413, { error: 'TOO_LARGE' });
      let body;
      try { body = JSON.parse(text); } catch { return json(400, { error: 'INVALID_JSON' }); }
      const rows: MetricRow[] = body.rows;
      const keys = ['reads', 'writes', 'deletes', 'failures', 'cacheReads'] as const;
      if (!Array.isArray(rows) || rows.length > 100 || !rows.every(row => row &&
        typeof row.collection === 'string' && /^[\w/-]{1,100}$/.test(row.collection) && !row.collection.startsWith('_firestoreMetric') &&
        typeof row.feature === 'string' && /^[\w/-]{1,100}$/.test(row.feature) &&
        keys.every(key => Number.isSafeInteger(row[key]) && row[key] >= 0 && row[key] <= 100_000))) {
        return json(400, { error: 'INVALID_METRICS' });
      }
      // Shared lease across serverless instances: local memory is not a rate limiter.
      const lease = db.collection(GLOBAL_COLLECTIONS.FIRESTORE_METRIC_INGRESS).doc(createHash('sha256').update(uid).digest('hex'));
      const accepted = await db.runTransaction(async tx => {
        const prior = await tx.get(lease);
        const now = Date.now();
        if (now - Number(prior.data()?.receivedAt ?? 0) < 30_000) return false;
        tx.set(lease, { receivedAt: now });
        return true;
      });
      if (!accepted) return json(429, { error: 'RATE_LIMITED' });
      await persistMetrics(rows.map(row => Object.fromEntries(['collection', 'feature', ...keys].map(key => [key, row[key as keyof MetricRow]])) as unknown as MetricRow), 'frontend');
      return json(200, { ok: true });
    }
    const user = await db.collection(GLOBAL_COLLECTIONS.USERS).doc(uid).get();
    if (!['developer', 'superAdmin', 'admin'].includes(user.data()?.role)) return json(403, { error: 'FORBIDDEN' });
    const params = new URL(request.url).searchParams;
    const days = Number(params.get('days') || 1);
    if (![1, 7, 30].includes(days)) return json(400, { error: 'INVALID_RANGE' });
    const start = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const snapshot = await db.collection(GLOBAL_COLLECTIONS.FIRESTORE_METRICS).where('date', '>=', start).limit(2001).get();
    return json(200, { rows: snapshot.docs.slice(0, 2000).map(doc => ({ id: doc.id, ...doc.data() })), truncated: snapshot.size > 2000 });
  } catch (error) {
    console.error('[firestore-monitoring]', error instanceof Error ? error.message : 'Unavailable');
    return json(503, { error: 'MONITORING_UNAVAILABLE' });
  }
}
