import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn(), setDoc: vi.fn() }));
vi.mock('./monitoredFirestore', () => ({
  doc: (...args: unknown[]) => args.join('/'), collection: (...args: unknown[]) => args.join('/'), query: (value: unknown) => value,
  getDoc: m.getDoc, getDocs: m.getDocs, setDoc: m.setDoc, addDoc: vi.fn(), updateDoc: vi.fn(), deleteDoc: vi.fn(), where: vi.fn(),
  Timestamp: { fromDate: (date: Date) => date },
}));
vi.mock('../../config/firebase', () => ({ db: 'db' }));
vi.mock('./auth', () => ({ convertFirestoreTimestamps: (value: unknown) => value }));
import { getAllStores } from './stores';
beforeEach(() => {
  vi.clearAllMocks(); m.getDoc.mockResolvedValue({ exists: () => false });
  m.getDocs.mockResolvedValue({ docs: [{ id: 'default', data: () => ({ id: '', name: 'Kota Kinabalu' }) }] });
});
it('lists lounges without attempting a default-store write and preserves the document ID', async () => {
  expect(await getAllStores({ ensureDefault: false })).toEqual([{ id: 'default', name: 'Kota Kinabalu' }]);
  expect(m.getDoc).not.toHaveBeenCalled(); expect(m.setDoc).not.toHaveBeenCalled();
});
it('keeps the existing provisioning behavior for callers which request the default store', async () => {
  await getAllStores(); expect(m.setDoc).toHaveBeenCalledOnce();
});
