// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ authorize: vi.fn(), get: vi.fn(), token: vi.fn() }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}] }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: m.token }) }));
vi.mock('../functions/_shared/firestoreMonitoring', () => ({ withFirestoreMonitoring: (_name: string, work: () => unknown) => work(), getFirestore: () => ({
  collection: () => ({ doc: () => ({ get: m.get }) }), runTransaction: (work: any) => work({}),
}) }));
vi.mock('../functions/_shared/loungeVisits', async original => ({ ...await original<typeof import('../functions/_shared/loungeVisits')>(), authorizeLounge: m.authorize }));
import handler from '../functions/lounge-operations';
const request = (extra = {}, token = 'token') => handler(new Request('http://localhost/.netlify/functions/lounge-operations', {
  method: 'POST', headers: { Authorization: `Bearer ${token}` },
  body: JSON.stringify({ action: 'report-details', storeId: 'lounge', reportId: 'report', reportKind: 'formal', ...extra }),
}));
describe('saved lounge debt detail access', () => {
  beforeEach(() => {
    vi.clearAllMocks(); m.authorize.mockResolvedValue({ role: 'developer' }); m.token.mockResolvedValue({ uid: 'staff' });
    m.get.mockResolvedValue({ data: () => ({ storeId: 'lounge', debtDetails: { customers: [] } }) });
  });
  it('returns saved evidence without recalculating or mutating financial records', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ debtDetails: { customers: [] } });
    expect(m.authorize).toHaveBeenCalledWith({}, expect.anything(), 'staff', 'staff', 'lounge', true);
  });
  it('denies staff outside their authorized lounge before reading a report', async () => {
    m.authorize.mockRejectedValue(new Error('forbidden'));
    expect((await request()).status).toBe(403); expect(m.get).not.toHaveBeenCalled();
  });
  it('denies a report belonging to another lounge', async () => {
    m.get.mockResolvedValue({ data: () => ({ storeId: 'other', debtDetails: { secret: true } }) });
    expect(await (await request()).json()).toMatchObject({ success: false, code: 'report-not-found' });
  });
  it('returns an explicit missing-details state for old reports', async () => {
    m.get.mockResolvedValue({ data: () => ({ storeId: 'lounge' }) });
    expect(await (await request()).json()).toMatchObject({ debtDetails: null });
  });
  it('rejects invalid report IDs', async () => {
    expect((await request({ reportId: '../other' })).status).toBe(409); expect(m.get).not.toHaveBeenCalled();
  });
});
