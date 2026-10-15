import { describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ getDocs: vi.fn() }));
vi.mock('../../config/firebase', () => ({ db: {} }));
vi.mock('./membershipFee', () => ({ getUserMembershipPeriod: async () => null }));
vi.mock('@/services/firebase/monitoredFirestore', () => ({
  doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(), addDoc: vi.fn(), updateDoc: vi.fn(), getDocs: m.getDocs,
  collection: vi.fn(), query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), Timestamp: {},
  documentId: vi.fn(), startAfter: vi.fn(),
  arrayUnion: vi.fn(), runTransaction: vi.fn(), FieldValue: {}, onSnapshot: vi.fn(),
}));
import { getDailyRedemptions, getHourlyRedemptions, getTotalRedemptions } from './redemption';

describe('strict redemption query errors', () => {
  const queries = [
    ['daily', (strict: boolean) => getDailyRedemptions('user', '2026-10-15', { throwOnError: strict })],
    ['hourly', (strict: boolean) => getHourlyRedemptions('user', '2026-10-15T10', { throwOnError: strict })],
    ['total', (strict: boolean) => getTotalRedemptions('user', { throwOnError: strict })],
  ] as const;
  it.each(queries)('%s distinguishes failed reads from valid empty results', async (_name, read) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      m.getDocs.mockRejectedValue(new Error('offline'));
      await expect(read(true)).rejects.toThrow('offline');
      await expect(read(false)).resolves.toEqual([]);
      m.getDocs.mockResolvedValue({ docs: [] });
      await expect(read(true)).resolves.toEqual([]);
    } finally { log.mockRestore(); }
  });
  it('paginates eligibility history past 500 documents and matches projection exclusions', async () => {
    m.getDocs.mockReset();
    const document = (id: string, entries: object[]) => ({ id, data: () => ({ userId: 'user', redemptions: entries }) });
    const valid = { quantity: 1, status: 'completed', redeemedAt: new Date(), createdAt: new Date() };
    m.getDocs.mockResolvedValueOnce({ docs: Array.from({ length: 500 }, (_, index) => document(String(index), [valid])) })
      .mockResolvedValueOnce({ docs: [document('last', [valid, { ...valid, quantity: 3, status: 'pending' },
        { ...valid, type: 'referral_reward' }, { ...valid, isDayPass: true }, { ...valid, status: 'cancelled' }])] });
    const rows = await getTotalRedemptions('user', { throwOnError: true });
    expect(m.getDocs).toHaveBeenCalledTimes(2);
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(504);
  });
});
