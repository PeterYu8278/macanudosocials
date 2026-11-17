import { describe, expect, it } from 'vitest';
import { compareRedemptionsPendingFirst } from './redemptionSort';

const record = (id: string, status: 'pending' | 'completed', date: string) => ({ id, status, redeemedAt: new Date(date) });

describe('pending-first redemption sorting', () => {
  it('pins older unfinished selections before newer completed redemptions', () => {
    const records = [record('completed-new', 'completed', '2026-10-15'), record('pending-old', 'pending', '2026-10-01'),
      record('completed-old', 'completed', '2026-10-14'), record('pending-new', 'pending', '2026-10-10')];
    expect([...records].sort(compareRedemptionsPendingFirst).map(item => item.id)).toEqual([
      'pending-new', 'pending-old', 'completed-new', 'completed-old',
    ]);
  });

  it('sorts before pagination so pending items cannot be buried on later pages', () => {
    const records = Array.from({ length: 20 }, (_, index) => record(`completed-${index}`, 'completed', '2026-10-15'));
    records.push(record('pending', 'pending', '2026-10-01'));
    expect(records.sort(compareRedemptionsPendingFirst).slice(0, 10)[0].id).toBe('pending');
  });

  it('supports Firestore timestamps and keeps equal-date items in their existing order', () => {
    const timestamp = { toDate: () => new Date('2026-10-15') } as unknown as Date;
    const records = [{ id: 'first', status: 'pending' as const, redeemedAt: timestamp }, record('second', 'pending', '2026-10-15')];
    expect(records.sort(compareRedemptionsPendingFirst).map(item => item.id)).toEqual(['first', 'second']);
  });
});
