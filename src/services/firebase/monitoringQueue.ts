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
let nextFlushAt = 0;
const cooldownKey = 'firestore-monitoring-cooldown';

function cooldownUntil() {
  try { return Math.max(nextFlushAt, Number(localStorage.getItem(cooldownKey)) || 0); }
  catch { return nextFlushAt; }
}

function setCooldown(milliseconds: number) {
  nextFlushAt = Date.now() + milliseconds;
  try { localStorage.setItem(cooldownKey, String(nextFlushAt)); } catch { /* Storage may be unavailable. */ }
}

export function recordFirestoreOperation(collection: string, kind: 'reads' | 'writes' | 'deletes' | 'failures' | 'cacheReads', count = 1) {
  if (!collection || collection.startsWith('_firestoreMetric') || typeof window === 'undefined') return;
  // Route only: query strings can contain registration tokens and phone numbers.
  const segments = window.location.pathname.split('/').filter(Boolean);
  const feature = (segments[0] === 'brand' ? 'brand' : segments.slice(0, 2).join('/')) || 'home';
  const key = `${collection}:${feature}`;
  if (!pending.has(key) && pending.size >= 100) return;
  const row = pending.get(key) ?? { collection, feature, reads: 0, writes: 0, deletes: 0, failures: 0, cacheReads: 0 };
  if (!Number.isSafeInteger(count) || count < 0) return;
  row[kind] = Math.min(100_000, row[kind] + count);
  pending.set(key, row);
}

export async function flushFirestoreMonitoring() {
  if (flushing || Date.now() < cooldownUntil() || !pending.size || !getApps().length) return;
  const user = getAuth().currentUser;
  if (!user) return;
  flushing = true;
  try {
    const token = await user.getIdToken();
    const rows = [...pending.values()];
    pending.clear();
    setCooldown(60_000);
    // Only a definitive rate-limit rejection is safe to replay; ambiguous failures
    // may already have persisted their counters on the server.
    const response = await fetch('/.netlify/functions/firestore-monitoring', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }), keepalive: true,
    });
    if (response.status === 429) {
      const retrySeconds = Number(response.headers.get('Retry-After'));
      setCooldown(Number.isFinite(retrySeconds) && retrySeconds > 0
        ? Math.max(60_000, Math.min(retrySeconds * 1000, 3_600_000)) : 60_000);
      for (const row of rows) {
        const key = `${row.collection}:${row.feature}`;
        if (!pending.has(key) && pending.size >= 100) continue;
        const newer = pending.get(key);
        for (const kind of ['reads', 'writes', 'deletes', 'failures', 'cacheReads'] as const) {
          row[kind] = Math.min(100_000, row[kind] + (newer?.[kind] ?? 0));
        }
        pending.set(key, row);
      }
    }
  } catch { /* Monitoring never interrupts a business operation. */ }
  finally { flushing = false; }
}

if (typeof window !== 'undefined') {
  window.setInterval(() => { void flushFirestoreMonitoring(); }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushFirestoreMonitoring();
  });
}
