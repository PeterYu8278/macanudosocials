import { getAuth } from 'firebase/auth';
import { getApps } from 'firebase/app';

export interface MetricRow {
  collection: string;
  feature: string;
  reads: number;
  writes: number;
  deletes: number;
  failures: number;
  cacheReads: number;
}

const pending = new Map<string, MetricRow>();
let flushing = false;

export function recordFirestoreOperation(collection: string, kind: 'reads' | 'writes' | 'deletes' | 'failures' | 'cacheReads', count = 1) {
  if (!collection || collection.startsWith('_firestoreMetric') || typeof window === 'undefined') return;
  // Route only: query strings can contain registration tokens and phone numbers.
  const segments = window.location.pathname.split('/').filter(Boolean);
  const feature = (segments[0] === 'brand' ? 'brand' : segments.slice(0, 2).join('/')) || 'home';
  const key = `${collection}:${feature}`;
  if (!pending.has(key) && pending.size >= 100) return;
  const row = pending.get(key) ?? { collection, feature, reads: 0, writes: 0, deletes: 0, failures: 0, cacheReads: 0 };
  row[kind] += count;
  pending.set(key, row);
}

export async function flushFirestoreMonitoring() {
  if (flushing || !pending.size || !getApps().length) return;
  const user = getAuth().currentUser;
  if (!user) return;
  flushing = true;
  try {
    const token = await user.getIdToken();
    const rows = [...pending.values()];
    pending.clear();
    // Best effort, no retries: diagnostics must not amplify a quota incident.
    await fetch('/.netlify/functions/firestore-monitoring', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }), keepalive: true,
    });
  } catch { /* Monitoring never interrupts a business operation. */ }
  finally { flushing = false; }
}

if (typeof window !== 'undefined') {
  window.setInterval(() => { void flushFirestoreMonitoring(); }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushFirestoreMonitoring();
  });
}
