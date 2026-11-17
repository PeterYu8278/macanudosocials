import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { getIdToken: vi.fn() } as { getIdToken: ReturnType<typeof vi.fn> } | null },
  fetch: vi.fn(), addDoc: vi.fn(),
}));
vi.mock('../../config/firebase', () => ({ auth: mocks.auth, db: {} }));
vi.mock('i18next', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/services/firebase/monitoredFirestore', () => ({
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(),
  addDoc: mocks.addDoc, query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
  Timestamp: { fromDate: (date: Date) => date },
}));
import { createReloadRecord, verifyReloadRecord, rejectReloadRecord, cancelReloadRecord } from './reload';

describe('authenticated reload review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentUser = { getIdToken: vi.fn().mockResolvedValue('token') };
    mocks.fetch.mockResolvedValue({ json: async () => ({ success: true, recordId: 'reload' }) });
    vi.stubGlobal('fetch', mocks.fetch);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('uses authenticated server approval, ignoring caller-supplied reviewer identity', async () => {
    expect(await verifyReloadRecord('reload', 'forged', 'https://proof', 'Received', 'Forged', 299)).toEqual({ success: true });
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url).toBe('/.netlify/functions/reload-review');
    expect(options.headers.Authorization).toBe('Bearer token');
    expect(JSON.parse(options.body)).toEqual({ recordId: 'reload', action: 'approve', proof: 'https://proof', notes: 'Received', actualAmount: 299 });
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });
  it('uses the same server for rejection and cancellation', async () => {
    await rejectReloadRecord('reload', 'forged', 'Invalid receipt');
    await cancelReloadRecord('reload', 'forged');
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).action).toBe('reject');
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body).action).toBe('cancel');
  });
  it.each([100, 200, 500])('submits RM%s manual reload to the server', async amount => {
    expect(await createReloadRecord('member', amount, 'Member', 'store')).toEqual({ success: true, recordId: 'reload' });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ action: 'create', amount, userId: 'member', storeId: 'store', operatorManual: false });
  });
  it('marks operator requests without trusting them to grant permissions', async () => {
    await createReloadRecord('member', 42, undefined, 'store', undefined, { manual: true });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).operatorManual).toBe(true);
  });
  it.each([0, -10, NaN, Infinity, 1.001])('rejects invalid amounts: %s', async amount => {
    expect((await createReloadRecord('member', amount, undefined, 'store')).success).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('reports rejection without writing client financial data', async () => {
    mocks.fetch.mockResolvedValue({ json: async () => ({ success: false, code: 'FORBIDDEN' }) });
    expect((await verifyReloadRecord('reload', 'forged')).success).toBe(false);
  });
  it('requires a signed-in user', async () => {
    mocks.auth.currentUser = null;
    expect((await createReloadRecord('member', 100)).success).toBe(false);
    expect((await verifyReloadRecord('reload', 'operator')).success).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('rejects legacy client-created online reloads', async () => {
    expect((await createReloadRecord('member', 200, 'Member', 'store', 'bill')).success).toBe(false);
    expect(mocks.addDoc).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each(['create', 'approve'])('shows the first membership requirement for %s', async action => {
    mocks.fetch.mockResolvedValue({ json: async () => ({ success: false, code: 'INITIAL_MEMBERSHIP_REQUIRED' }) });
    const result = action === 'create' ? await createReloadRecord('member', 200, 'Member', 'store')
      : await verifyReloadRecord('reload', 'operator');
    expect(result).toEqual({ success: false, error: 'annualPassPayment.initialMembershipRequired' });
  });
});
