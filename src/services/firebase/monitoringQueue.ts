import { getAuth } from 'firebase/auth';
import { getApps } from 'firebase/app';
import { isMonitoringOperation, metricCounterLimit, OPTIONAL_METRIC_COUNTERS, type ExtendedMetrics } from './monitoringMetrics';

export interface MetricRow extends ExtendedMetrics {
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

export interface MonitoringContext { feature: string; operation?: ExtendedMetrics['operation'] }
const routes = new Set(['events', 'shop', 'profile', 'ai-cigar-history', 'reload', 'payment/result', 'auth/complete-profile',
  'admin', 'admin/users', 'admin/inventory', 'admin/events', 'admin/orders', 'admin/reports', 'admin/finance',
  'admin/points-config', 'admin/visit-sessions', 'admin/stores', 'admin/system-config', 'admin/notifications',
  'developer/orphaned-users', 'developer/performance', 'developer/feature-management', 'developer/subscription',
  'developer/invoice-template', 'developer/cigar-database', 'developer/gemini-tester', 'developer/cloudinary-test',
  'developer/debug-orders', 'developer/test-data-generator']);
export function captureMonitoringContext(operation?: ExtendedMetrics['operation']): MonitoringContext {
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname;
  const feature = pathname === '/' ? 'home' : pathname.startsWith('/brand/') ? 'brand'
    : routes.has(pathname.slice(1)) ? pathname.slice(1) : 'unknown';
  return { feature, ...(isMonitoringOperation(operation) ? { operation } : {}) };
}

export function recordFirestoreOperation(collection: string, kind: 'reads' | 'writes' | 'deletes' | 'failures' | 'cacheReads', count = 1,
  attribution = captureMonitoringContext(), metrics: ExtendedMetrics = {}) {
  if (!collection || collection.startsWith('_firestoreMetric') || typeof window === 'undefined') return;
  const feature = ['home', 'brand', 'unknown'].includes(attribution.feature) || routes.has(attribution.feature) ? attribution.feature : 'unknown';
  const operation = isMonitoringOperation(attribution.operation) ? attribution.operation : undefined;
  const key = JSON.stringify([collection, feature, operation]);
  if (!pending.has(key) && pending.size >= 100) return;
  const row = pending.get(key) ?? { collection, feature, reads: 0, writes: 0, deletes: 0, failures: 0, cacheReads: 0 };
  if (operation) row.operation = operation;
  if (!Number.isSafeInteger(count) || count < 0) return;
  row[kind] = Math.min(100_000, row[kind] + count);
  for (const field of OPTIONAL_METRIC_COUNTERS) {
    const value = metrics[field];
    if (value !== undefined && Number.isSafeInteger(value) && value >= 0) {
      row[field] = Math.min(metricCounterLimit(field), (row[field] ?? 0) + value);
    }
  }
  pending.set(key, row);
}

export async function flushFirestoreMonitoring() {
  if (flushing || Date.now() < cooldownUntil() || !pending.size || !getApps().length) return;
  const user = getAuth().currentUser;
  if (!user) return;
  flushing = true;
  try {
    const token = await user.getIdToken();
    const rows: MetricRow[] = [];
    let bytes = new TextEncoder().encode('{"rows":[]}').length;
    for (const [key, row] of pending) {
      const rowBytes = new TextEncoder().encode(JSON.stringify(row)).length + (rows.length ? 1 : 0);
      if (bytes + rowBytes > 30_000) break;
      bytes += rowBytes;
      rows.push(row);
      pending.delete(key);
    }
    if (!rows.length) return;
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
        const key = JSON.stringify([row.collection, row.feature, row.operation]);
        if (!pending.has(key) && pending.size >= 100) continue;
        const newer = pending.get(key);
        for (const kind of ['reads', 'writes', 'deletes', 'failures', 'cacheReads'] as const) {
          row[kind] = Math.min(100_000, row[kind] + (newer?.[kind] ?? 0));
        }
        for (const field of OPTIONAL_METRIC_COUNTERS) {
          if (row[field] !== undefined || newer?.[field] !== undefined) {
            row[field] = Math.min(metricCounterLimit(field), (row[field] ?? 0) + (newer?.[field] ?? 0));
          }
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
