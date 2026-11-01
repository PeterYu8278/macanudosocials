// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { readLoungeStatus } from '../functions/_shared/loungeStatus';

function fixture(count: number) {
  const rows = Array.from({ length: count }, (_, n) => ({ id: `batch-${n}`, data: () => ({ businessDate: `2026-10-${String(n + 1).padStart(2, '0')}`, revision: n === 19 ? 2 : 1 }) }));
  const get = vi.fn().mockResolvedValue({ docs: rows });
  const getAll = vi.fn(async (...refs: any[]) => refs.filter(ref => ref.path).reverse().map(ref => ({ id: ref.id, data: () =>
    ref.path.startsWith('_loungeDailyReports/') ? { text: ref.id, delivery: { status: 'accepted', taskId: ref.id.endsWith('_v2') ? 'custom-task' : undefined } }
      : ref.id === 'custom-task' ? { status: 'delivered' } : undefined })));
  const collection = (name: string): any => ({ where: () => ({ get }), doc: (id: string) => ({ id, path: `${name}/${id}` }) });
  return { db: { collection, getAll } as unknown as Firestore, getAll, get };
}
describe('bulk closing batch status reads', () => {
  it('uses two bulk reads for fourteen reports and tasks, preserving sort and custom task IDs', async () => {
    const { db, getAll } = fixture(20);
    const rows = await readLoungeStatus(db, 'lounge');
    expect(rows).toHaveLength(14);
    expect(rows[0]).toMatchObject({ businessDate: '2026-10-20', reportText: 'lounge_2026-10-20_v2', reportStatus: 'delivered' });
    expect(rows[1].reportStatus).toBe('accepted');
    expect(getAll).toHaveBeenCalledTimes(2);
    expect(getAll.mock.calls[0]).toHaveLength(15);
    expect(getAll.mock.calls[1]).toHaveLength(15);
    expect(getAll.mock.calls[0][14]).toEqual({ fieldMask: ['text', 'delivery.status', 'delivery.taskId'] });
    expect(getAll.mock.calls[1][14]).toEqual({ fieldMask: ['status'] });
    expect(getAll.mock.calls[1][0].id).toBe('custom-task');
  });
  it('does no related reads for an empty lounge', async () => {
    const { db, getAll } = fixture(0);
    expect(await readLoungeStatus(db, 'lounge')).toEqual([]);
    expect(getAll).not.toHaveBeenCalled();
  });
  it('keeps missing reports explicit rather than inventing delivery status', async () => {
    const { db, getAll } = fixture(1);
    getAll.mockImplementation(async (...refs: any[]) => refs.filter(ref => ref.path).map(ref => ({ id: ref.id, data: () => undefined })));
    expect((await readLoungeStatus(db, 'lounge'))[0]).toMatchObject({ reportStatus: 'not-sent', reportText: '' });
  });
});
