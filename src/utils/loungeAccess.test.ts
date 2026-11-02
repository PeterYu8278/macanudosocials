import { describe, expect, it } from 'vitest';
import { canManageLounge, managedLoungeIds } from './loungeAccess';
describe('lounge scope', () => {
  it('unions legacy and multiple assignments without empty or duplicate IDs', () => {
    expect(managedLoungeIds({ storeId: 'A', storeIds: ['B', '', null, 'A'] })).toEqual(['A', 'B']);
  });
  it('never grants member access from an assignment field alone', () => {
    expect(canManageLounge({ role: 'member', storeIds: ['A'] }, 'A')).toBe(false);
    expect(canManageLounge({ role: 'admin' }, 'A')).toBe(false);
    expect(canManageLounge({ role: 'superAdmin' }, 'A')).toBe(true);
  });
});
