import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const { deriveRedemptionAdminMetadata, syncRedemptionAdminMetadata } = require('./redemptionAdminMetadata.cjs');

describe('trusted grouped redemption metadata', () => {
  it('derives scope from the historical session, preserves legacy completed items and rejects orphans', () => {
    expect(deriveRedemptionAdminMetadata({ storeId: 'wrong', redemptions: [{ status: 'pending' }, {}] }, { storeId: 'historical' }))
      .toEqual({ storeId: 'historical', adminStatuses: ['completed', 'pending'] });
    expect(() => deriveRedemptionAdminMetadata({ redemptions: [] }, {})).toThrow('SESSION_STORE_REQUIRED');
  });
  it('rereads current source in a transaction and writes metadata only', async () => {
    const source = { exists: true, data: () => ({ redemptions: [{ status: 'pending' }, {}] }) };
    const session = { exists: true, data: () => ({ storeId: 's' }) };
    const tx = { get: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(session), update: vi.fn() };
    const db = { collection: (name: string) => ({ doc: (id: string) => ({ name, id }) }), runTransaction: (fn: any) => fn(tx) };
    await expect(syncRedemptionAdminMetadata(db, 'visit')).resolves.toEqual({ changed: true });
    expect(tx.update).toHaveBeenCalledWith({ name: 'redemptionRecords', id: 'visit' }, { storeId: 's', adminStatuses: ['completed', 'pending'] });
  });
  it('does not recreate deleted sources or loop on its own trigger writes', async () => {
    const tx = { get: vi.fn().mockResolvedValueOnce({ exists: false }), update: vi.fn() };
    const db = { collection: () => ({ doc: () => ({}) }), runTransaction: (fn: any) => fn(tx) };
    await expect(syncRedemptionAdminMetadata(db, 'deleted')).resolves.toEqual({ changed: false });
    expect(tx.update).not.toHaveBeenCalled();
    tx.get.mockResolvedValueOnce({ exists: true, data: () => ({ storeId: 's', adminStatuses: ['pending'], redemptions: [{ status: 'pending' }] }) })
      .mockResolvedValueOnce({ exists: true, data: () => ({ storeId: 's' }) });
    await expect(syncRedemptionAdminMetadata(db, 'same')).resolves.toEqual({ changed: false });
    expect(tx.update).not.toHaveBeenCalled();
  });
});
