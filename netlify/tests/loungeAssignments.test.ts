// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { loungeAssignments } from '../functions/_shared/loungeAssignments';
import { authorizeLounge } from '../functions/_shared/loungeVisits';
let records: Record<string, any>, writes: string[];
const ref = (path: string) => ({ path, id: path.split('/').at(-1) });
const snap = (path: string) => ({ id: path.split('/').at(-1), exists: !!records[path], data: () => records[path] });
const tx = {
  get: async (r: any) => {
    if (!r.query) return snap(r.path);
    const docs = Object.keys(records).filter(path => path.startsWith('users/')
      && (r.field === 'role' ? r.value.includes(records[path].role) : records[path][r.field] === r.value)).map(snap);
    return { size: docs.length, docs };
  },
  update: (r: any, data: any) => { writes.push(r.path); records[r.path] = { ...records[r.path], ...data }; },
  create: (r: any, data: any) => { writes.push(r.path); records[r.path] = data; },
};
const db = { collection: (name: string) => ({ doc: (id = 'audit') => ref(`${name}/${id}`),
  where: (field: string, _op: string, value: any) => ({ limit: () => ({ query: true, field, value }) }) }), runTransaction: async (fn: any) => fn(tx) } as unknown as Firestore;
const request = (assigned: boolean, expectedStoreIds = ['A']) => ({ action: 'assign-lounge-admin', storeId: 'B', userId: 'target', assigned, expectedStoreIds });
beforeEach(() => { writes = []; records = { 'users/actor': { role: 'developer', status: 'active' },
  'users/target': { role: 'admin', storeId: 'A', membership: { points: 100 } }, 'stores/B': { name: 'Lounge B' } }; });
describe('multi-lounge administrator assignments', () => {
  it('lists only assignable administrators and does not expose their private profiles', async () => {
    records['users/target'].email = 'private@example.test';
    records['users/target'].displayName = 'Target';
    const result = await loungeAssignments(db, 'actor', { action: 'list-lounge-admins', storeId: 'B' });
    expect(result).toEqual({ admins: [{ id: 'target', name: 'Target', role: 'admin', storeIds: ['A'] }] });
    expect(writes).toEqual([]);
  });
  it('resolves a linked global operator and refuses a missing lounge', async () => {
    await expect(loungeAssignments(db, 'actor', { ...request(true), storeId: 'missing' })).rejects.toThrow('lounge-unavailable');
    records['users/actor'].authUid = 'linked-auth';
    await expect(loungeAssignments(db, 'linked-auth', request(true))).resolves.toEqual({ storeIds: ['A', 'B'] });
  });
  it('adds a second lounge while preserving the primary lounge, role and wallet', async () => {
    expect(await loungeAssignments(db, 'actor', request(true))).toEqual({ storeIds: ['A', 'B'] });
    expect(records['users/target']).toMatchObject({ role: 'admin', storeId: 'A', storeIds: ['A', 'B'], membership: { points: 100 } });
    expect(records['audit_logs/audit']).toMatchObject({ action: 'lounge-admin-assignment', before: { storeIds: ['A'] }, after: { storeIds: ['A', 'B'] } });
  });
  it('removes only this lounge and chooses a remaining primary when needed', async () => {
    records['users/target'].storeId = 'B'; records['users/target'].storeIds = ['A', 'B', 'C'];
    await loungeAssignments(db, 'actor', request(false, ['A', 'B', 'C']));
    expect(records['users/target']).toMatchObject({ storeId: 'A', storeIds: ['A', 'C'] });
  });
  it('can remove the final assignment without retaining legacy access', async () => {
    records['users/target'].storeId = 'B';
    await loungeAssignments(db, 'actor', request(false, ['B']));
    expect(records['users/target']).toMatchObject({ storeId: null, storeIds: [] });
  });
  it.each(['admin', 'storeAdmin', 'member'])('rejects assignment management by %s', async role => {
    records['users/actor'] = { role, storeId: 'B' };
    await expect(loungeAssignments(db, 'actor', request(true))).rejects.toThrow('forbidden'); expect(writes).toEqual([]);
  });
  it('rejects suspended global operators and stale or invalid targets without writes', async () => {
    records['users/actor'].status = 'suspended';
    await expect(loungeAssignments(db, 'actor', request(true))).rejects.toThrow('forbidden');
    records['users/actor'].status = 'active';
    await expect(loungeAssignments(db, 'actor', request(true, []))).rejects.toThrow('assignment-conflict');
    records['users/target'].role = 'member';
    await expect(loungeAssignments(db, 'actor', request(true))).rejects.toThrow('invalid-request'); expect(writes).toEqual([]);
  });
  it.each(['admin', 'storeAdmin'])('authorizes %s for all assigned lounges, not unassigned lounges', async role => {
    records['users/target'] = { role, storeId: 'A', storeIds: ['B', 'C'] };
    for (const id of ['A', 'B', 'C']) await expect(authorizeLounge(tx, db, 'target', 'target', id, true)).resolves.toMatchObject({ role });
    await expect(authorizeLounge(tx, db, 'target', 'target', 'D', true)).rejects.toThrow('forbidden');
  });
});
