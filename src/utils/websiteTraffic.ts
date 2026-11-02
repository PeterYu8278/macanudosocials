export const TRAFFIC_EVENTS = ['page_view', 'engaged_visit', 'whatsapp_click', 'phone_click', 'registration_start'] as const;
export type BrowserTrafficEvent = typeof TRAFFIC_EVENTS[number];
export type TrafficEvent = BrowserTrafficEvent | 'registration_success' | 'membership_activated';
export const TRAFFIC_PAGES = ['guest_landing', 'member_home', 'events', 'shop', 'profile', 'reload'] as const;
export type TrafficPage = typeof TRAFFIC_PAGES[number];
export const TRAFFIC_SOURCES = ['google', 'bing', 'instagram', 'facebook', 'whatsapp', 'ai', 'other', 'direct', 'unknown'] as const;
export type TrafficSource = typeof TRAFFIC_SOURCES[number];
export interface TrafficContext {
  visitor: string; session: string; source: TrafficSource; medium: string; campaign: string;
  capturedAt: number; loungeId: 'default';
}
export interface TrafficInput extends TrafficContext { id: string; type: BrowserTrafficEvent; page: TrafficPage; at: number }
export interface TrafficCounts { page_view: number; engaged_visit: number; whatsapp_click: number; phone_click: number;
  registration_start: number; registration_success: number; membership_activated: number }
export const emptyTrafficCounts = (): TrafficCounts => ({ page_view: 0, engaged_visit: 0, whatsapp_click: 0, phone_click: 0,
  registration_start: 0, registration_success: 0, membership_activated: 0 });
export const trafficDay = (at: number) => new Date(at + 8 * 3600000).toISOString().slice(0, 10);
export const trafficHour = (at: number) => new Date(at + 8 * 3600000).toISOString().slice(0, 13);
export const safeCampaign = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : '';
export const validTrafficId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{20,64}$/i.test(v);
export function trafficContext(value: any, now = Date.now()): TrafficContext | null {
  if (!value || !validTrafficId(value.visitor) || !validTrafficId(value.session)
    || !TRAFFIC_SOURCES.includes(value.source) || value.loungeId !== 'default'
    || !Number.isFinite(value.capturedAt) || value.capturedAt > now + 60000 || value.capturedAt < now - 30 * 86400000) return null;
  return { visitor: value.visitor, session: value.session, source: value.source, loungeId: 'default',
    medium: safeCampaign(value.medium), campaign: safeCampaign(value.campaign), capturedAt: value.capturedAt };
}
export function parseTrafficEvent(value: any, now = Date.now()): TrafficInput | null {
  const context = trafficContext(value, now);
  if (!context || !validTrafficId(value.id) || !TRAFFIC_EVENTS.includes(value.type) || !TRAFFIC_PAGES.includes(value.page)
    || !Number.isFinite(value.at) || value.at > now + 60000 || value.at < now - 86400000) return null;
  return { ...context, id: value.id, type: value.type, page: value.page, at: Math.min(value.at, now) };
}
export function sourceOf(search: string, referrer: string): TrafficSource {
  const utm = new URLSearchParams(search).get('utm_source')?.toLowerCase();
  const named: Record<string, TrafficSource> = { google: 'google', bing: 'bing', instagram: 'instagram', facebook: 'facebook', whatsapp: 'whatsapp', chatgpt: 'ai', perplexity: 'ai', claude: 'ai' };
  if (utm) return named[utm] || 'other';
  let host = ''; try { host = new URL(referrer).hostname.toLowerCase(); } catch { return 'direct'; }
  if (host === 'macanudosocials.com' || host === 'www.macanudosocials.com') return 'direct';
  if (/(^|\.)google\.(?:com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(host)) return 'google';
  for (const [domain, source] of Object.entries({ 'bing.com': 'bing', 'instagram.com': 'instagram', 'facebook.com': 'facebook',
    'whatsapp.com': 'whatsapp', 'chatgpt.com': 'ai', 'chat.openai.com': 'ai', 'perplexity.ai': 'ai', 'claude.ai': 'ai' })) {
    if (host === domain || host.endsWith('.' + domain)) return source as TrafficSource;
  }
  return 'other';
}
// Mergeable HyperLogLog: range UV is estimated from the union, never summed daily.
// 1024 registers give roughly 3.25% standard error. Only server-hashed IDs enter it.
export const SKETCH_SIZE = 1024;
export function addSketch(registers: number[], hash: number) {
  const index = hash >>> 22;
  const rank = Math.min(23, Math.clz32((hash << 10) >>> 0) + 1);
  registers[index] = Math.max(registers[index] || 0, rank);
}
export function mergeSketch(target: number[], source: number[]) {
  for (let i = 0; i < SKETCH_SIZE; i++) target[i] = Math.max(target[i] || 0, source[i] || 0);
  return target;
}
export function estimateSketch(registers: number[]) {
  const m = SKETCH_SIZE, zeros = registers.filter(v => !v).length;
  const raw = (0.7213 / (1 + 1.079 / m)) * m * m / registers.reduce((sum, v) => sum + 2 ** -v, 0);
  return Math.round(raw <= 2.5 * m && zeros ? m * Math.log(m / zeros) : raw);
}
