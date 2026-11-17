import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { addSketch, mergeSketch, estimateSketch, SKETCH_SIZE, parseTrafficEvent, trafficContext, trafficDay, trafficHour, sourceOf } from './websiteTraffic';

const now = Date.parse('2026-11-02T16:00:00Z');
const sample = { visitor: '12345678-1234-1234-1234-123456789012', session: '12345678-1234-1234-1234-123456789013',
  id: '12345678-1234-1234-1234-123456789014', page: 'guest_landing', type: 'page_view', source: 'google',
  medium: 'organic', campaign: 'membership', capturedAt: now, at: now, loungeId: 'default' };
it('uses MYT calendar boundaries rather than UTC dates', () => {
  expect(trafficDay(now - 1)).toBe('2026-11-02'); expect(trafficDay(now)).toBe('2026-11-03');
  expect(trafficHour(now)).toBe('2026-11-03T00');
});
it('accepts only bounded browser events and removes extra/private attributes', () => {
  expect(parseTrafficEvent({ ...sample, email: 'private@example.com', url: '/?token=secret' }, now)).toEqual(sample);
  for (const patch of [{ type: 'membership_activated' }, { page: 'admin' }, { source: '__proto__' },
    { at: now - 86400001 }, { at: now + 60001 }, { visitor: '../../users' }]) expect(parseTrafficEvent({ ...sample, ...patch }, now)).toBeNull();
  expect(parseTrafficEvent({ ...sample, campaign: 'private@example.com' }, now)?.campaign).toBe('');
});
it('expires first-touch attribution after 30 days', () => {
  expect(trafficContext(sample, now + 30 * 86400000)).toBeTruthy();
  expect(trafficContext(sample, now + 30 * 86400000 + 1)).toBeNull();
});
it('classifies referral domains without trusting lookalike hosts', () => {
  expect(sourceOf('', 'https://www.google.com/search?q=secret')).toBe('google');
  expect(sourceOf('', 'https://chatgpt.com/')).toBe('ai');
  expect(sourceOf('', 'https://google.com.evil.test/')).toBe('other');
  expect(sourceOf('?utm_source=instagram', 'https://google.com')).toBe('instagram');
  expect(sourceOf('', '')).toBe('direct');
});
it('unions visitors across days instead of adding daily unique totals', () => {
  const a = Array(SKETCH_SIZE).fill(0), b = Array(SKETCH_SIZE).fill(0);
  const h = (i: number) => createHash('sha256').update('visitor-' + i).digest().readUInt32BE(0);
  for (let i = 0; i < 5000; i++) addSketch(a, h(i));
  for (let i = 2500; i < 7500; i++) addSketch(b, h(i));
  const estimate = estimateSketch(mergeSketch(a.slice(), b));
  expect(estimate).toBeGreaterThan(6900); expect(estimate).toBeLessThan(8100);
  expect(estimateSketch(mergeSketch(a.slice(), a))).toBe(estimateSketch(a));
  expect(estimateSketch(Array(SKETCH_SIZE).fill(0))).toBe(0);
});
