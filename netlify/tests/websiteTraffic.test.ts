// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { persistWebsiteEvent, summarizeWebsiteHours, reconcileWebsiteConversions } from '../functions/_shared/websiteTraffic';
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections';

const values = new Map<string, any>();
const ref = (path: string) => ({ path, get: async () => ({ data: () => values.get(path) }) });
function query(name: string, filters: any[] = [], after?: any[], cap = 50): any {
  return { where: (...filter: any[]) => query(name, [...filters, filter], after, cap), orderBy: () => query(name, filters, after, cap),
    startAfter: (...cursor: any[]) => query(name, filters, cursor, cap), limit: (limit: number) => query(name, filters, after, limit),
    get: async () => {
      const rows = [...values.entries()].filter(([path]) => path.startsWith(name + '/')).map(([path, data]) => ({ id: path.split('/')[1], data: () => data }));
      const field = filters[0]?.[0];
      const docs = rows.filter(doc => filters.every(([key, op, value]) => op === '>=' ? doc.data()[key]?.toMillis() >= value.toMillis() : doc.data()[key]?.toMillis() <= value.toMillis()))
        .sort((a, b) => a.data()[field].toMillis() - b.data()[field].toMillis() || a.id.localeCompare(b.id))
        .filter(doc => !after || doc.data()[field].toMillis() > after[0].toMillis() || (doc.data()[field].toMillis() === after[0].toMillis() && doc.id > after[1])).slice(0, cap);
      return { docs, size: docs.length };
    } };
}
const db: any = {
  collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`), where: (...filter: any[]) => query(name, [filter]) }),
  runTransaction: async (run: any) => {
    const writes: (() => void)[] = [];
    const result = await run({ get: async (r: any) => ({ exists: values.has(r.path), data: () => values.get(r.path) }),
      set: (r: any, value: any, options?: any) => writes.push(() => values.set(r.path, options?.merge ? { ...values.get(r.path), ...value } : value)) });
    writes.forEach(write => write()); return result;
  },
};
const context: any = { visitor: '12345678-1234-1234-1234-123456789012', session: '12345678-1234-1234-1234-123456789013', source: 'google', medium: 'organic', campaign: '', capturedAt: Date.now(), loungeId: 'default' };
const event = { id: crypto.randomUUID(), type: 'page_view' as const, page: 'guest_landing' as const, at: Date.now(), context, loungeId: 'default' };
const hours = () => [...values.entries()].filter(([key]) => key.startsWith(C.WEBSITE_HOURS + '/')).map(([, value]) => value);
beforeEach(() => { values.clear(); vi.restoreAllMocks(); });
it('deduplicates retries and commits a receipt with the summary', async () => {
  expect(await persistWebsiteEvent(db, event)).toBe(true);
  expect(await persistWebsiteEvent(db, event)).toBe(false);
  expect(summarizeWebsiteHours(hours())).toMatchObject({ counts: { page_view: 1 }, visitors: 1, sessions: 1 });
});
it('counts genuine refreshes while unique browsers and sessions remain deduplicated', async () => {
  await persistWebsiteEvent(db, event);
  await persistWebsiteEvent(db, { ...event, id: crypto.randomUUID() });
  expect(summarizeWebsiteHours(hours())).toMatchObject({ counts: { page_view: 2 }, visitors: 1, sessions: 1 });
});
it('counts engagement only once per session, even across pages and event IDs', async () => {
  await persistWebsiteEvent(db, { ...event, type: 'engaged_visit' });
  await persistWebsiteEvent(db, { ...event, type: 'engaged_visit', page: 'shop', id: crypto.randomUUID() });
  expect(summarizeWebsiteHours(hours()).counts.engaged_visit).toBe(1);
});
it('keeps unlinked backend conversions Unknown and never manufactures visitors', async () => {
  await persistWebsiteEvent(db, { ...event, type: 'registration_success', context: null });
  const summary = summarizeWebsiteHours(hours());
  expect(summary.sources.unknown.registration_success).toBe(1); expect(summary.visitors).toBe(0);
  const receipt = [...values.entries()].find(([key]) => key.startsWith(C.WEBSITE_EVENTS + '/'))![1];
  expect(receipt).not.toHaveProperty('visitor'); expect(receipt.expiresAt).toBeInstanceOf(Timestamp);
});
it('resumes a large conversion window using a timestamp/document cursor, without losing equal-time users', async () => {
  const now = Date.now();
  values.set(C.WEBSITE_JOBS + '/conversions', { through: now - 60000 });
  for (let i = 0; i < 350; i++) values.set(C.USERS + '/member-' + i.toString().padStart(4, '0'), {
    role: 'guest', createdAt: Timestamp.fromMillis(now - 30000),
  });
  expect(await reconcileWebsiteConversions(db)).toMatchObject({ pending: true });
  expect(values.get(C.WEBSITE_JOBS + '/conversions').through).toBe(now - 60000);
  expect(await reconcileWebsiteConversions(db)).toMatchObject({ pending: false });
  expect(summarizeWebsiteHours(hours()).counts.registration_success).toBe(350);
  // Ten-minute overlap re-reads the window but never increments an already recorded conversion.
  await reconcileWebsiteConversions(db); await reconcileWebsiteConversions(db);
  expect(summarizeWebsiteHours(hours()).counts.registration_success).toBe(350);
});
it('counts paid initial activations once per customer and ignores renewals and pending fees', async () => {
  const now = Date.now(); values.set(C.WEBSITE_JOBS + '/conversions', { through: now - 60000 });
  for (const [id, renewalType, status] of [['a', 'initial', 'paid'], ['b', 'initial', 'paid'], ['c', 'renewal', 'paid'], ['d', 'initial', 'pending']]) {
    values.set(C.MEMBERSHIP_FEE_RECORDS + '/' + id, { userId: 'member', renewalType, status, storeId: 'default', deductedAt: Timestamp.fromMillis(now - 1000) });
  }
  await reconcileWebsiteConversions(db);
  expect(summarizeWebsiteHours(hours()).counts.membership_activated).toBe(1);
});
it('keeps campaign attribution available without storing arbitrary referrer URLs', async () => {
  await persistWebsiteEvent(db, { ...event, context: { ...context, campaign: 'membership', medium: 'social' } });
  const summary = summarizeWebsiteHours(hours());
  expect(summary.campaigns['google / social / membership'].page_view).toBe(1);
});
