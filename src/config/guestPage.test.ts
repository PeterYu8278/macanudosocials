import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { DEFAULT_GUEST_PAGE as base, currentGuestMembership, guestPageConfig, guestMetadata, nextGuestPageRevision, validateGuestPage, GUEST_SOCIAL_IMAGE } from './guestPage';
describe('approved public guest information', () => {
  it('publishes matching static and runtime sharing metadata with an existing standard-size image', () => {
    const document = new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html');
    const content = (property: string) => document.querySelector(`meta[property="${property}"]`)?.getAttribute('content');
    const metadata = guestMetadata(base);
    expect(metadata.title.length).toBeLessThanOrEqual(60);
    expect(document.title).toBe(metadata.title);
    expect(content('og:title')).toBe(metadata.title);
    expect(content('og:site_name')).toBe('Macanudo Socials');
    expect(content('og:image')).toBe(GUEST_SOCIAL_IMAGE.url);
    expect(content('og:image:width')).toBe(String(GUEST_SOCIAL_IMAGE.width));
    expect(content('og:image:height')).toBe(String(GUEST_SOCIAL_IMAGE.height));
    expect(content('og:image:type')).toBe(GUEST_SOCIAL_IMAGE.type);
    expect(content('og:image:alt')).toBe(GUEST_SOCIAL_IMAGE.alt);
    expect(document.querySelector('meta[name="twitter:image"]')?.getAttribute('content')).toBe(GUEST_SOCIAL_IMAGE.url);
    expect(existsSync(`public${new URL(GUEST_SOCIAL_IMAGE.url).pathname}`)).toBe(true);
  });
  it('publishes the confirmed storefront and annual membership without a salon offer', () => {
    expect(base).toMatchObject({ phone: '60162773800', opensAt: '11:00', closesAt: '23:00' });
    expect(currentGuestMembership(base, Date.parse('2026-11-02T00:00:00+08:00'))).toMatchObject({ annualPrice: 299, credit: 100, cigarsPerYear: 25 });
    expect(guestMetadata(base).schema.openingHoursSpecification[0].dayOfWeek).toHaveLength(7);
  });
  it('selects the effective version at the exact boundary and preserves earlier versions', () => {
    const now = Date.parse('2026-12-01T00:00:00+08:00');
    const draft = { ...base, membershipVersions: [...base.membershipVersions, { ...base.membershipVersions[0], id: 'future', effectiveAt: new Date(now).toISOString(), annualPrice: 350, credit: 120 }] };
    expect(currentGuestMembership(draft, now - 1)?.annualPrice).toBe(299);
    expect(currentGuestMembership(draft, now)?.annualPrice).toBe(350);
    expect(nextGuestPageRevision(base, draft, now - 1).membershipVersions).toHaveLength(2);
    expect(currentGuestMembership(base, 0)).toBeNull();
  });
  it('refuses stale edits, history removal, backdating and duplicate effective times', () => {
    expect(() => nextGuestPageRevision(base, { ...base, revision: 1 })).toThrow('public-profile-conflict');
    expect(() => nextGuestPageRevision(base, { ...base, membershipVersions: [{ ...base.membershipVersions[0], annualPrice: 400 }] })).toThrow('public-profile-history');
    const old = { ...base.membershipVersions[0], id: 'backdated', effectiveAt: '2026-11-01T00:00:00+08:00' };
    expect(() => nextGuestPageRevision(base, { ...base, membershipVersions: [...base.membershipVersions, old] }, Date.parse('2026-11-02'))).toThrow('public-profile-history');
    expect(() => validateGuestPage({ ...base, membershipVersions: [...base.membershipVersions, { ...base.membershipVersions[0], id: 'duplicate-time' }] })).toThrow();
  });
  it('rejects malformed hours, phones and amounts rather than publishing them', () => {
    for (const bad of [{ ...base, phone: '+60 <script>' }, { ...base, opensAt: '25:00' }, { ...base, closesAt: '10:00' },
      { ...base, membershipVersions: [{ ...base.membershipVersions[0], annualPrice: NaN }] }]) {
      expect(() => validateGuestPage(bad)).toThrow('invalid-public-profile');
      expect(guestPageConfig(bad)).toBe(base);
    }
  });
});
