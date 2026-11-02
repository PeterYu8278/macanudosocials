import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_GUEST_PAGE } from '../../config/guestPage';

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), getDocFromCache: vi.fn(), set: vi.fn(), get: vi.fn(), runTransaction: vi.fn() }));
vi.mock('./monitoredFirestore', () => ({
  doc: (...parts: unknown[]) => parts.join('/'), collection: (...parts: unknown[]) => parts.join('/'),
  getDoc: mocks.getDoc, getDocFromCache: mocks.getDocFromCache,
  setDoc: vi.fn(), updateDoc: vi.fn(), runTransaction: mocks.runTransaction,
  Timestamp: { now: () => new Date('2026-11-02T12:00:00Z') },
}));
vi.mock('../../config/firebase', () => ({ db: 'db' }));
vi.mock('./auditLog', () => ({ saveAuditLog: vi.fn() }));

import { getAppConfig, invalidateAppConfigCache } from './appConfig';
import { saveGuestPage } from './guestPage';

beforeEach(() => { vi.clearAllMocks(); invalidateAppConfigCache(); });

it.each([false, true])('keeps published guest settings when reading config (offline=%s)', async offline => {
  const profile = { ...DEFAULT_GUEST_PAGE, phone: '60123456789', revision: 3 };
  const snapshot = { id: 'default', exists: () => true, data: () => ({ guestPage: profile }) };
  if (offline) mocks.getDoc.mockRejectedValue(new Error('offline'));
  else mocks.getDoc.mockResolvedValue(snapshot);
  mocks.getDocFromCache.mockResolvedValue(snapshot);
  expect((await getAppConfig())?.guestPage).toEqual(profile);
});

it('atomically saves public settings and audit without replacing other app settings', async () => {
  mocks.get.mockResolvedValue({ data: () => ({ guestPage: DEFAULT_GUEST_PAGE }) });
  mocks.runTransaction.mockImplementation(async (_db, operation) => operation({ get: mocks.get, set: mocks.set }));
  const draft = { ...DEFAULT_GUEST_PAGE, phone: '60123456789' };
  const result = await saveGuestPage(draft, 'developer-id');
  expect(result.revision).toBe(1);
  expect(mocks.set).toHaveBeenCalledTimes(2);
  expect(mocks.set.mock.calls[0]).toEqual(['db/app_config/default', expect.objectContaining({ guestPage: result, updatedBy: 'developer-id' }), { merge: true }]);
  expect(mocks.set.mock.calls[1][1]).toMatchObject({ operatorId: 'developer-id', details: { before: DEFAULT_GUEST_PAGE, after: result } });
});

it('refuses a stale revision before any write', async () => {
  mocks.get.mockResolvedValue({ data: () => ({ guestPage: { ...DEFAULT_GUEST_PAGE, revision: 1 } }) });
  mocks.runTransaction.mockImplementation(async (_db, operation) => operation({ get: mocks.get, set: mocks.set }));
  await expect(saveGuestPage(DEFAULT_GUEST_PAGE, 'developer-id')).rejects.toThrow('public-profile-conflict');
  expect(mocks.set).not.toHaveBeenCalled();
});
