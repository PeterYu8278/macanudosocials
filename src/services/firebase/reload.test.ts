import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'operator' } as { uid: string } | null },
  getDoc: vi.fn(),
  addDoc: vi.fn(),
  getDocs: vi.fn(), updateDoc: vi.fn(), createPointsRecord: vi.fn(),
}));
vi.mock('../../config/firebase', () => ({ auth: mocks.auth, db: {} }));
vi.mock('./pointsRecords', () => ({ createPointsRecord: mocks.createPointsRecord }));
vi.mock('./pointsConfig', () => ({ getPointsConfig: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, name: string) => ({ name }),
  doc: (_db: unknown, collection: string, id: string) => ({ collection, id }),
  getDoc: mocks.getDoc, getDocs: mocks.getDocs,
  addDoc: mocks.addDoc, setDoc: vi.fn(), updateDoc: mocks.updateDoc, deleteDoc: vi.fn(),
  query: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), startAfter: vi.fn(),
  Timestamp: { fromDate: (date: Date) => date },
}));
import { createReloadRecord, verifyReloadRecord, rejectReloadRecord } from './reload';

const pendingRecord = () => ({
  id: 'reload-1', exists: () => true,
  data: () => ({ userId: 'member-1', status: 'pending', requestedAmount: 100, pointsEquivalent: 100, createdAt: new Date(), updatedAt: new Date() }),
});

describe('reload reviewer attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocs.mockResolvedValue({ empty: false, docs: [] });
    mocks.updateDoc.mockResolvedValue(undefined);
    mocks.createPointsRecord.mockResolvedValue({ id: 'points-1' });
  });

  it('saves the approver ID and name with the completed reload', async () => {
    mocks.getDoc.mockResolvedValueOnce(pendingRecord()).mockResolvedValueOnce({ exists: () => true, data: () => ({ membership: { points: 10 } }) });
    expect(await verifyReloadRecord('reload-1', 'reviewer-1', undefined, 'Approved', ' Alice ')).toEqual({ success: true });
    expect(mocks.updateDoc).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'reload-1' }), expect.objectContaining({ status: 'completed', verifiedBy: 'reviewer-1', verifiedByName: 'Alice' }));
    expect(mocks.createPointsRecord).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'reviewer-1' }));
  });

  it('saves the reviewer identity for rejection too', async () => {
    mocks.getDoc.mockResolvedValueOnce(pendingRecord());
    expect(await rejectReloadRecord('reload-1', 'reviewer-2', 'Invalid proof', 'Bob')).toEqual({ success: true });
    expect(mocks.updateDoc).toHaveBeenCalledWith(expect.objectContaining({ id: 'reload-1' }), expect.objectContaining({ status: 'rejected', verifiedBy: 'reviewer-2', verifiedByName: 'Bob' }));
  });

  it('keeps callers without a reviewer name compatible without writing undefined', async () => {
    mocks.getDoc.mockResolvedValueOnce(pendingRecord());
    expect(await rejectReloadRecord('reload-1', 'reviewer-2')).toEqual({ success: true });
    expect(mocks.updateDoc.mock.calls[0][1]).not.toHaveProperty('verifiedByName');
  });

  it('does not change records that have already been reviewed', async () => {
    mocks.getDoc.mockResolvedValueOnce({ id: 'reload-1', exists: () => true, data: () => ({ status: 'completed', createdAt: new Date(), updatedAt: new Date() }) });
    expect((await verifyReloadRecord('reload-1', 'reviewer-1', undefined, undefined, 'Alice')).success).toBe(false);
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });
});

describe('reload amount validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.currentUser = { uid: 'operator' };
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'admin', displayName: 'Member' }) });
    mocks.addDoc.mockResolvedValue({ id: 'reload' });
  });

  it.each([0.01, 42, 100, 300])('allows a positive manual amount of RM%s', async amount => {
    expect(await createReloadRecord('member', amount, undefined, undefined, undefined, { manual: true }))
      .toEqual({ success: true, recordId: 'reload' });
    expect(mocks.addDoc.mock.calls[0][1].requestedAmount).toBe(amount);
    expect(mocks.getDoc).toHaveBeenCalledTimes(2);
  });

  it.each([0, -10, NaN, Infinity])('rejects invalid manual amounts: %s', async amount => {
    expect((await createReloadRecord('member', amount, undefined, undefined, undefined, { manual: true })).success).toBe(false);
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('retains the RM300 member minimum', async () => {
    expect((await createReloadRecord('member', 42)).success).toBe(false);
    expect((await createReloadRecord('member', 300)).success).toBe(true);
  });

  it('does not permit members to use manual mode', async () => {
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'member' }) });
    expect((await createReloadRecord('member', 42, undefined, undefined, undefined, { manual: true })).success).toBe(false);
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated manual creation', async () => {
    mocks.auth.currentUser = null;
    expect((await createReloadRecord('member', 42, undefined, undefined, undefined, { manual: true })).success).toBe(false);
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });

  it('does not bypass the online reload minimum using manual mode', async () => {
    expect((await createReloadRecord('member', 42, undefined, undefined, 'bill', { manual: true })).success).toBe(false);
    expect(mocks.addDoc).not.toHaveBeenCalled();
  });
});
