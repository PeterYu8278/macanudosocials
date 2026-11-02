export interface GuestMembershipVersion {
  id: string; effectiveAt: string; annualPrice: number; credit: number; cigarsPerYear: number;
  firstVisitFree: boolean; drinksAndSnacks: boolean; referralRewards: boolean; nonSmokerCompanion: boolean;
}
export interface GuestPageConfig {
  revision: number; loungeName: string; address: string; phone: string; opensAt: string; closesAt: string;
  membershipVersions: GuestMembershipVersion[];
}
export const DEFAULT_GUEST_PAGE: GuestPageConfig = {
  revision: 0, loungeName: 'Macanudo Socials Kota Kinabalu',
  address: 'BLOCK J, UNIT 56, GROUND FLOOR, (P1/J/56/0), OFF Jalan Coastal, 88100 Kota Kinabalu, Sabah',
  phone: '60162773800', opensAt: '11:00', closesAt: '23:00',
  membershipVersions: [{ id: 'confirmed-20261102', effectiveAt: '2026-11-02T00:00:00+08:00', annualPrice: 299, credit: 100,
    cigarsPerYear: 25, firstVisitFree: true, drinksAndSnacks: true, referralRewards: true, nonSmokerCompanion: true }],
};
export function validateGuestPage(value: GuestPageConfig) {
  const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if (!value || !Number.isInteger(value.revision) || value.revision < 0 || !text(value.loungeName, 120) || !text(value.address, 500)
    || !/^[1-9]\d{6,14}$/.test(value.phone) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.opensAt)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.closesAt) || value.opensAt >= value.closesAt
    || !Array.isArray(value.membershipVersions) || value.membershipVersions.length < 1 || value.membershipVersions.length > 100) throw new Error('invalid-public-profile');
  const times = new Set<number>(), ids = new Set<string>();
  for (const v of value.membershipVersions) {
    if (!v || typeof v !== 'object') throw new Error('invalid-public-profile');
    const at = Date.parse(v.effectiveAt);
    if (!text(v.id, 100) || !Number.isFinite(at) || !/(Z|[+-]\d\d:\d\d)$/.test(v.effectiveAt) || ids.has(v.id) || times.has(at)
      || ![v.annualPrice, v.credit].every(n => Number.isFinite(n) && n >= 0 && n <= 100000 && Math.abs(n * 100 - Math.round(n * 100)) < 0.00001)
      || !Number.isInteger(v.cigarsPerYear) || v.cigarsPerYear < 0 || v.cigarsPerYear > 1000
      || ![v.firstVisitFree, v.drinksAndSnacks, v.referralRewards, v.nonSmokerCompanion].every(b => typeof b === 'boolean')) throw new Error('invalid-public-profile');
    ids.add(v.id); times.add(at);
  }
}
export function currentGuestMembership(config: GuestPageConfig, now = Date.now()) {
  return config.membershipVersions.filter(v => Date.parse(v.effectiveAt) <= now)
    .sort((a, b) => Date.parse(b.effectiveAt) - Date.parse(a.effectiveAt))[0] ?? null;
}
export function nextGuestPageRevision(previous: GuestPageConfig, value: GuestPageConfig, now = Date.now()): GuestPageConfig {
  validateGuestPage(value);
  if (previous.revision !== value.revision) throw new Error('public-profile-conflict');
  for (const version of previous.membershipVersions) {
    if (JSON.stringify(value.membershipVersions.find(v => v.id === version.id)) !== JSON.stringify(version)) throw new Error('public-profile-history');
  }
  if (value.membershipVersions.filter(v => !previous.membershipVersions.some(p => p.id === v.id)).some(v => Date.parse(v.effectiveAt) < now)) throw new Error('public-profile-history');
  return { ...value, revision: previous.revision + 1 };
}
export function guestPageConfig(value?: GuestPageConfig): GuestPageConfig {
  if (value) { try { validateGuestPage(value); return value; } catch { /* Use the owner-confirmed public profile. */ } }
  return DEFAULT_GUEST_PAGE;
}
export function guestContactUrl(config: GuestPageConfig) { return `https://wa.me/${config.phone}`; }
export const GUEST_SOCIAL_IMAGE = {
  url: 'https://macanudosocials.com/og-cover-1200x630-v1.jpg',
  width: 1200,
  height: 630,
  type: 'image/jpeg',
  alt: 'Macanudo Socials Kota Kinabalu lounge with daily 11am–11pm opening hours and WhatsApp contact.',
} as const;
export function guestMetadata(config: GuestPageConfig) {
  const membership = currentGuestMembership(config);
  return { title: `${config.loungeName} | Cigar Lounge`,
    description: `${config.loungeName}. A premium cigar lounge and social club in Kota Kinabalu, Sabah. Open daily ${config.opensAt}–${config.closesAt}. Contact +${config.phone}.`,
    schema: {
      '@context': 'https://schema.org',
      '@type': ['LocalBusiness', 'FoodEstablishment'],
      name: config.loungeName,
      description: 'A premium cigar lounge and social club in Kota Kinabalu, Sabah, Malaysia. Annual membership includes lounge credit, cigars, and exclusive access.',
      url: 'https://macanudosocials.com/',
      telephone: `+${config.phone}`,
      priceRange: membership ? `RM ${membership.annualPrice}/year membership` : undefined,
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Block J, Unit 56, Ground Floor, Off Jalan Coastal',
        addressLocality: 'Kota Kinabalu',
        addressRegion: 'Sabah',
        postalCode: '88100',
        addressCountry: 'MY',
      },
      geo: { '@type': 'GeoCoordinates', latitude: 5.9749, longitude: 116.0724 },
      image: [
        'https://macanudosocials.com/lounge/lounge-hero.png',
        'https://macanudosocials.com/lounge/quiet-lounge.png',
        'https://macanudosocials.com/lounge/window-lounge.png',
      ],
      openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        opens: config.opensAt, closes: config.closesAt }],
      sameAs: [`https://wa.me/${config.phone}`],
    } };
}
