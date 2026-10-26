// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections';
const m = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock('../functions/_shared/loungeVisits', () => ({ authorizeLounge: m.authorize,
  asDate: (value: any) => value?.toDate?.() || new Date(value),
  loungeError: (code: string, details = {}) => Object.assign(new Error(code), { details }),
}));
import { saveWalletDebtBaseline } from '../functions/_shared/walletDebtBaseline';

describe('audited wallet debt baselines', () => {
  let docs: Map<string, any>, writes: string[];
  const now = Date.parse('2026-10-26T15:00:00Z'), at = Date.parse('2026-10-20T15:00:00Z');
  const input = () => ({ storeId: 'lounge', userId: 'user', at, balance: 156, expectedVersion: 0,
    evidenceReference: 'archive/batch-verified/member-001', note: 'Verified independent source and all transactions through cutoff', confirm: true });
  const ref = (path: string): any => ({ path, get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }) });
  const db = { collection: (name: string) => ({
    doc: (id = `audit-${writes.length}`) => ref(`${name}/${id}`),
    where: () => ({ limit: () => ({ get: async () => {
      const rows = [...docs].filter(([key]) => key.startsWith(`${name}/`)).map(([id, data]) => ({ id, data: () => data }));
      return { docs: rows, size: rows.length };
    } }) }),
  }), runTransaction: async (work: any) => {
    const staged: Array<() => void> = [];
    const output = await work({ get: (target: any) => { if (staged.length) throw new Error('read-after-write'); return target.get(); },
      set: (target: any, value: any) => staged.push(() => { writes.push(target.path); docs.set(target.path, value); }),
      create: (target: any, value: any) => staged.push(() => { if (docs.has(target.path)) throw new Error('duplicate'); writes.push(target.path); docs.set(target.path, value); }),
    });
    staged.forEach(apply => apply()); return output;
  } } as unknown as Firestore;
  beforeEach(() => {
    m.authorize.mockReset().mockResolvedValue({ role: 'developer' }); writes = [];
    docs = new Map([
      [`${C.STORES}/lounge`, { name: 'Lounge' }],
      [`${C.USERS}/user`, { membership: { points: 136 } }],
      [`${C.POINTS_RECORDS}/spend`, { type: 'spend', amount: 20, balanceBefore: 156, balance: 136, createdAt: new Date(at + 1000), storeId: 'lounge' }],
    ]);
  });
  it('writes only baseline metadata, immutable version and audit, never wallet or point records', async () => {
    expect(await saveWalletDebtBaseline(db, 'reviewer', input(), now)).toEqual({ version: 1 });
    expect(writes).toEqual([`${C.WALLET_DEBT_BASELINES}/user`, `${C.WALLET_DEBT_BASELINE_VERSIONS}/user_v1`, `${C.AUDIT_LOGS}/audit-0`]);
    expect(docs.get(`${C.USERS}/user`).membership.points).toBe(136);
    expect(docs.get(`${C.WALLET_DEBT_BASELINES}/user`)).toMatchObject({ balance: 156, reviewedBy: 'reviewer', boundary: 'through_timestamp' });
  });
  it('requires independent evidence and explicit confirmation', async () => {
    await expect(saveWalletDebtBaseline(db, 'reviewer', { ...input(), evidenceReference: '' }, now)).rejects.toThrow('invalid-baseline');
    await expect(saveWalletDebtBaseline(db, 'reviewer', { ...input(), confirm: false }, now)).rejects.toThrow('invalid-baseline');
    expect(writes).toEqual([]);
  });
  it('rejects a guessed balance that does not reconcile', async () => {
    await expect(saveWalletDebtBaseline(db, 'reviewer', { ...input(), balance: 155 }, now)).rejects.toThrow('baseline-does-not-reconcile');
    expect(writes).toEqual([]);
  });
  it('rejects ordinary staff and stale versions', async () => {
    m.authorize.mockResolvedValueOnce({ role: 'storeAdmin' });
    await expect(saveWalletDebtBaseline(db, 'reviewer', input(), now)).rejects.toThrow('forbidden');
    await saveWalletDebtBaseline(db, 'reviewer', input(), now);
    await expect(saveWalletDebtBaseline(db, 'reviewer', input(), now)).rejects.toThrow('baseline-conflict');
  });
  it('rejects suspended reviewers and nonexistent lounge contexts', async () => {
    m.authorize.mockResolvedValueOnce({ role: 'developer', status: 'suspended' });
    await expect(saveWalletDebtBaseline(db, 'reviewer', input(), now)).rejects.toThrow('forbidden');
    docs.delete(`${C.STORES}/lounge`);
    await expect(saveWalletDebtBaseline(db, 'reviewer', input(), now)).rejects.toThrow('lounge-unavailable');
    expect(writes).toEqual([]);
  });
  it('preserves earlier approved versions when evidence is revised', async () => {
    await saveWalletDebtBaseline(db, 'reviewer', input(), now);
    const original = structuredClone(docs.get(`${C.WALLET_DEBT_BASELINE_VERSIONS}/user_v1`));
    await saveWalletDebtBaseline(db, 'reviewer', { ...input(), expectedVersion: 1, note: 'Rechecked and added independent archival proof' }, now + 1000);
    expect(docs.get(`${C.WALLET_DEBT_BASELINE_VERSIONS}/user_v1`)).toEqual(original);
    expect(docs.get(`${C.WALLET_DEBT_BASELINE_VERSIONS}/user_v2`).version).toBe(2);
  });
});
