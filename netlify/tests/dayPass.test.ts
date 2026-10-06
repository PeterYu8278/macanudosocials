// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { executeDayPass } from '../functions/_shared/dayPass';

let records: Record<string, any>;
const writes = vi.fn();
let nextId = 0;
const ref = (collection: string, id: string) => ({ id, path: `${collection}/${id}` });
const collection = (name: string) => ({
  doc: (id = `generated-${++nextId}`) => ref(name, id),
  where: (_field: string, _op: string, value: string) => ({
    where: () => ({ pendingUser: value }),
    limit: () => ({ authUid: value }),
  }),
});
const read = (reference: any) => {
  if (reference.authUid) {
    const docs = Object.entries(records).filter(([path, value]) => path.startsWith('users/') && value.authUid === reference.authUid)
      .map(([path, value]) => ({ id: path.split('/')[1], data: () => value }));
    return { docs, size: docs.length };
  }
  if (reference.pendingUser) return { docs: Object.entries(records)
    .filter(([path, value]) => path.startsWith('visitSessions/') && value.userId === reference.pendingUser && value.status === 'pending')
    .map(([path, value]) => ({ id: path.split('/')[1], data: () => value })) };
  const value = records[reference.path];
  return { exists: value !== undefined, data: () => value };
};
const db = {
  collection,
  runTransaction: async (callback: any) => {
    const staged: any[] = [];
    const result = await callback({
      get: async (reference: any) => read(reference),
      update: (reference: any, data: any) => staged.push(['update', reference.path, data]),
      set: (reference: any, data: any, options: any) => staged.push(['set', reference.path, data, options]),
    });
    for (const [method, path, data, options] of staged) {
      writes(method, path, data);
      const value = method === 'update' || options?.merge ? { ...records[path] } : {};
      for (const [key, field] of Object.entries(data)) {
        if (key.includes('.')) {
          const [parent, child] = key.split('.');
          value[parent] = { ...value[parent], [child]: field };
        } else value[key] = field;
      }
      records[path] = value;
    }
    return result;
  },
} as unknown as Firestore;
const now = { toDate: () => new Date('2026-10-06T04:00:00Z') } as Timestamp;
const input = { action: 'purchase', userId: 'member', storeId: 'lounge', requestId: 'request-1' };
const purchase = (changes = {}, uid = 'member') => executeDayPass(db, uid, { ...input, ...changes }, now);

describe('atomic Day Pass purchase', () => {
  beforeEach(() => {
    writes.mockClear(); nextId = 0;
    records = {
      'users/member': { displayName: 'Member', role: 'guest', status: 'inactive', membership: { points: 300 } },
      'users/operator': { role: 'developer' },
      'stores/lounge': { name: 'Lounge' },
      'config/points': { dayPass: { enabled: true, cost: 100, freeHours: 3, hourlyRateAfter: 30, cigarAllowance: 2 } },
    };
  });
  it('atomically debits points and stores price/entitlement snapshots', async () => {
    const result = await purchase();
    expect(records['users/member'].membership.points).toBe(200);
    expect(records[`visitSessions/${result.sessionId}`].dayPass.config).toMatchObject({ cost: 100, cigarAllowance: 2 });
    expect(records[`redemptionRecords/${result.sessionId}`].redemptions[0].quantity).toBe(2);
    expect(records[`pointsRecords/daypass_${result.sessionId}`]).toMatchObject({ amount: 100, balance: 200 });
  });
  it('denies disabled purchases without any writes', async () => {
    records['config/points'].dayPass.enabled = false;
    await expect(purchase()).rejects.toThrow('disabled');
    expect(writes).not.toHaveBeenCalled();
  });
  it('does not charge again on repeated requests or when new purchases are disabled', async () => {
    const first = await purchase();
    records['config/points'].dayPass.enabled = false;
    writes.mockClear();
    expect(await purchase({ requestId: 'another-request' })).toEqual({ sessionId: first.sessionId, alreadyPurchased: true });
    expect(writes).not.toHaveBeenCalled();
    expect(records['users/member'].membership.points).toBe(200);
  });
  it('supports a mapped legacy member without email-based authorization', async () => {
    records['users/member'].authUid = 'auth-member';
    expect((await purchase({}, 'auth-member')).alreadyPurchased).toBe(false);
  });
  it('rejects another member and suspended accounts', async () => {
    await expect(purchase({}, 'other')).rejects.toThrow('forbidden');
    records['users/member'].status = 'suspended';
    await expect(purchase()).rejects.toThrow('account-suspended');
    expect(writes).not.toHaveBeenCalled();
  });
  it('checks the latest balance inside the transaction', async () => {
    records['users/member'].membership.points = 99;
    await expect(purchase()).rejects.toThrow('insufficient-points');
    expect(writes).not.toHaveBeenCalled();
  });
  it('keeps missing enabled fields compatible', async () => {
    delete records['config/points'].dayPass.enabled;
    expect((await purchase()).alreadyPurchased).toBe(false);
  });
  it.each([0, -1, '100', NaN])('rejects invalid pricing: %s', async cost => {
    records['config/points'].dayPass.cost = cost;
    await expect(purchase()).rejects.toThrow('invalid-config');
    expect(writes).not.toHaveBeenCalled();
  });
  it('honors a zero cigar allowance', async () => {
    records['config/points'].dayPass.cigarAllowance = 0;
    const result = await purchase();
    expect(records[`visitSessions/${result.sessionId}`].redemptions).toEqual([]);
    expect(records[`redemptionRecords/${result.sessionId}`]).toBeUndefined();
  });
  it('rejects mismatched, completed, or membership sessions', async () => {
    for (const changes of [{ userId: 'other' }, { storeId: 'other' }, { status: 'completed' }, { checkInType: 'membership' }]) {
      records['visitSessions/visit'] = { userId: 'member', storeId: 'lounge', status: 'pending', ...changes };
      await expect(purchase({ sessionId: 'visit' })).rejects.toThrow('invalid-session');
    }
    expect(writes).not.toHaveBeenCalled();
  });
  it('preserves existing redemption records when purchasing for a valid visit', async () => {
    records['visitSessions/visit'] = { userId: 'member', storeId: 'lounge', status: 'pending', redemptions: [{ recordId: 'old' }] };
    records['redemptionRecords/visit'] = { redemptions: [{ id: 'old' }], createdAt: 'original' };
    await purchase({ sessionId: 'visit' });
    expect(records['redemptionRecords/visit'].redemptions).toHaveLength(2);
    expect(records['redemptionRecords/visit'].createdAt).toBe('original');
  });
  it('rejects invalid identifiers', async () => {
    await expect(purchase({ userId: '../other' })).rejects.toThrow('invalid-request');
    expect(writes).not.toHaveBeenCalled();
  });
});

describe('Day Pass toggle permissions and audit', () => {
  beforeEach(() => { writes.mockClear(); records = {
    'users/operator': { role: 'developer' }, 'config/points': { dayPass: { cost: 100 } },
  }; });
  it('writes an audit event and preserves pricing', async () => {
    await executeDayPass(db, 'operator', { action: 'set-enabled', enabled: false }, now);
    expect(records['config/points'].dayPass).toEqual({ cost: 100, enabled: false });
    expect(writes).toHaveBeenCalledWith('set', expect.stringMatching(/^audit_logs\//), expect.objectContaining({ before: true, after: false, userId: 'operator' }));
  });
  it.each(['admin', 'storeAdmin', 'member'])('rejects toggles by %s', async role => {
    records['users/operator'].role = role;
    await expect(executeDayPass(db, 'operator', { action: 'set-enabled', enabled: false }, now)).rejects.toThrow('forbidden');
    expect(writes).not.toHaveBeenCalled();
  });
  it('does not duplicate audits for unchanged values', async () => {
    await executeDayPass(db, 'operator', { action: 'set-enabled', enabled: true }, now);
    expect(writes).not.toHaveBeenCalled();
  });
  it('allows a uniquely mapped legacy developer to manage the toggle', async () => {
    records['users/operator'].authUid = 'legacy-auth';
    await executeDayPass(db, 'legacy-auth', { action: 'set-enabled', enabled: false }, now);
    expect(records['config/points'].dayPass.enabled).toBe(false);
  });
});
