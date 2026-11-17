// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: {} as any, due: {} as any, paidHistory: true, update: vi.fn(), set: vi.fn() }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}] }));
vi.mock('../functions/_shared/firestoreMonitoring', () => {
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path) });
  const snapshot = (path: string): any => ({
    id: path.split('/').at(-1), ref: ref(path),
    exists: ['users/member', 'membershipFeeRecords/due', 'config/membershipFee'].includes(path),
    data: () => path === 'users/member' ? m.user : path === 'membershipFeeRecords/due' ? m.due
      : path === 'config/membershipFee' ? { annualFees: [{ startDate: '2020-01-01', amount: 199 }] } : undefined,
  });
  const query = (paid = false): any => ({
    where: (_key: string, _op: string, value: unknown) => query(paid || value === 'paid'),
    orderBy: () => query(paid), limit: () => query(paid),
    doc: (id: string) => ref(`pointsRecords/${id || 'new'}`),
    get: async () => ({ size: 1, docs: paid
      ? (m.paidHistory ? [{ data: () => ({ amount: 199, status: 'paid' }) }] : [])
      : [snapshot('membershipFeeRecords/due')] }),
  });
  return {
    Timestamp: class { static fromDate(date: Date) { return date; } },
    getFirestore: () => ({ doc: ref, collection: () => query(), runTransaction: async (work: any) => work({
      get: async (target: any) => target.path ? snapshot(target.path) : target.get(), update: m.update, set: m.set,
    }) }),
    withFirestoreMonitoring: (_feature: string, work: () => unknown) => work(),
  };
});
import handler from '../functions/process-membership-renewals';
const run = async () => (await handler(new Request('https://test/.netlify/functions/process-membership-renewals'))).json();

describe('scheduled renewal eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.user = { status: 'inactive', role: 'member', membership: { points: 500, activeUntil: new Date('2025-01-01') } };
    m.due = { userId: 'member', status: 'pending', renewalType: 'renewal', dueDate: new Date('2025-01-01') };
    m.paidHistory = true;
  });
  it('deducts the fee only for a verified expired renewal', async () => {
    expect(await run()).toMatchObject({ paid: 1 });
    expect(m.update.mock.calls.find(([ref]) => ref.path === 'users/member')?.[1]).toMatchObject({
      'membership.points': 301, status: 'active', role: 'vip', 'membership.nextFirstVisitWaiverExpiresAt': null,
    });
  });
  it('does not use a pending initial fee to bypass the first-payment package', async () => {
    m.due.renewalType = 'initial';
    expect(await run()).toMatchObject({ skipped: 1, paid: 0 });
    expect(m.update).not.toHaveBeenCalled();
  });
  it('does not debit based only on account dates without a paid fee record', async () => {
    m.paidHistory = false;
    expect(await run()).toMatchObject({ skipped: 1, paid: 0 });
    expect(m.update).not.toHaveBeenCalled();
  });
  it('does not charge an unexpired pass again', async () => {
    m.user.membership.activeUntil = new Date(Date.now() + 86400000);
    expect(await run()).toMatchObject({ skipped: 1 });
    expect(m.update).not.toHaveBeenCalled();
  });
  it('does not reactivate a suspended account', async () => {
    m.user.status = 'suspended';
    expect(await run()).toMatchObject({ skipped: 1 });
    expect(m.update).not.toHaveBeenCalled();
  });
  it('does not charge an active legacy account with an unknown expiry', async () => {
    m.user.status = 'active';
    delete m.user.membership.activeUntil;
    expect(await run()).toMatchObject({ skipped: 1 });
    expect(m.update).not.toHaveBeenCalled();
  });
  it('does not deduct when the verified renewal has insufficient points', async () => {
    m.user.membership.points = 100;
    expect(await run()).toMatchObject({ insufficient: 1, paid: 0 });
    expect(m.update.mock.calls.find(([ref]) => ref.path === 'users/member')?.[1]).not.toHaveProperty('membership.points');
  });
});
