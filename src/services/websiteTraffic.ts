import { sourceOf, safeCampaign, trafficContext, validTrafficId, type TrafficContext, type TrafficInput, type BrowserTrafficEvent, type TrafficPage } from '../utils/websiteTraffic';

const PREFIX = 'ms-traffic-v1-';
const memory = new Map<string, string>();
function read(key: string) { try { return localStorage.getItem(PREFIX + key) || memory.get(key) || null; } catch { return memory.get(key) || null; } }
function write(key: string, value: unknown) { const text = JSON.stringify(value); memory.set(key, text); try { localStorage.setItem(PREFIX + key, text); } catch { /* Ephemeral IDs when storage is unavailable. */ } }
function value<T>(key: string): T | null { try { return JSON.parse(read(key) || 'null'); } catch { return null; } }
export function trafficAllowed() {
  return import.meta.env.PROD && ['macanudosocials.com', 'www.macanudosocials.com'].includes(location.hostname)
    && navigator.doNotTrack !== '1' && read('opt-out') !== 'true' && import.meta.env.VITE_WEBSITE_TRAFFIC_ENABLED !== 'false';
}
let queue: TrafficInput[] | null = null, sending = false, failures = 0, nextAttempt = 0;
function pending() {
  if (queue) return queue;
  const saved = value<TrafficInput[]>('queue');
  return queue = (Array.isArray(saved) ? saved : []).filter(e => e && e.at > Date.now() - 86400000).slice(-100);
}
function context(): TrafficContext {
  const now = Date.now();
  let visitor = value<string>('visitor'); if (!validTrafficId(visitor)) { visitor = crypto.randomUUID(); write('visitor', visitor); }
  let current = value<TrafficContext & { activeAt: number }>('session');
  if (!trafficContext(current) || !Number.isFinite(current?.activeAt) || now - current!.activeAt > 1800000) {
    const search = new URLSearchParams(location.search);
    current = { visitor, session: crypto.randomUUID(), source: sourceOf(location.search, document.referrer),
      medium: safeCampaign(search.get('utm_medium')), campaign: safeCampaign(search.get('utm_campaign')),
      loungeId: 'default', capturedAt: now, activeAt: now };
  }
  current!.activeAt = now; write('session', current);
  if (!trafficContext(value('attribution'))) write('attribution', current);
  return current!;
}
export function getWebsiteAttribution(): TrafficContext | null {
  try {
    if (!trafficAllowed()) return null;
    context(); return trafficContext(value('attribution'));
  } catch { return null; }
}
let page: TrafficPage | null = null;
const once = new Set<string>();
export function setTrafficPage(next: TrafficPage | null) { page = next; }
export function recordWebsiteEvent(type: BrowserTrafficEvent) {
  try {
  if (!trafficAllowed() || !page) return;
  const current = context(), key = `${current.session}:${type}`;
  if (['engaged_visit', 'registration_start'].includes(type)) {
    if (once.has(key)) return;
    if (once.size > 100) once.clear(); once.add(key);
  }
  const event: TrafficInput = { ...current, id: crypto.randomUUID(), type, page, at: Date.now() };
  pending().push(event); queue = pending().slice(-100); write('queue', queue);
  if (['whatsapp_click', 'phone_click', 'registration_start'].includes(type)) recordWebsiteEvent('engaged_visit');
  } catch { /* Optional telemetry must never interrupt browsing or registration. */ }
}
export async function flushWebsiteTraffic() {
  if (!trafficAllowed() || sending || !pending().length || Date.now() < nextAttempt || !navigator.onLine) return;
  queue = pending().filter(e => e.at > Date.now() - 86400000);
  if (!queue.length) { write('queue', queue); return; }
  const batch = pending().slice(0, 20); sending = true;
  const dropBatch = () => { const ids = new Set(batch.map(e => e.id)); queue = pending().filter(e => !ids.has(e.id)); write('queue', queue); };
  const retry = (after = 0) => {
    failures++; nextAttempt = Date.now() + Math.max(after, Math.min(300000, 5000 * 2 ** failures));
    if (failures >= 5) { dropBatch(); failures = 0; nextAttempt = Date.now() + 300000; }
  };
  try {
    const response = await fetch('/api/website-traffic', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }), keepalive: true, signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      if ([400, 403, 413].includes(response.status)) {
        dropBatch(); failures = 0; nextAttempt = Date.now() + 30000; return;
      }
      retry(Math.min(300000, (Number(response.headers?.get('Retry-After')) || 0) * 1000)); return;
    }
    dropBatch(); failures = 0; nextAttempt = 0;
  } catch { retry(); }
  finally { sending = false; }
}
export function setWebsiteTrafficOptOut(disabled: boolean) {
  write('opt-out', disabled);
  if (disabled) {
    queue = []; write('queue', []);
    for (const key of ['visitor', 'session', 'attribution']) { memory.delete(key); try { localStorage.removeItem(PREFIX + key); } catch { /* no storage */ } }
  }
}
export const websiteTrafficOptedOut = () => read('opt-out') === 'true' || navigator.doNotTrack === '1';
let lastActivity = 0;
export function touchWebsiteSession() {
  if (page && trafficAllowed() && Date.now() - lastActivity > 15000) {
    try { context(); lastActivity = Date.now(); } catch { /* Optional telemetry. */ }
  }
}
