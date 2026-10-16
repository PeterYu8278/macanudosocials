import { describe, expect, it } from 'vitest';
import type { VisitSession } from '../types';
import { sortVisitSessions } from './visitSessionSort';

const session = (id: string, status: VisitSession['status'], checkInAt: Date, checkOutAt?: Date): VisitSession => ({
  id, status, checkInAt, checkOutAt, userId: 'member', storeId: 'lounge', checkInBy: 'admin', createdAt: checkInAt, updatedAt: checkInAt,
});

describe('visit session display order', () => {
  it('pins older checked-in sessions above newer completed/expired sessions', () => {
    const records = [session('completed', 'completed', new Date('2026-10-15')), session('older-pending', 'pending', new Date('2026-10-01')),
      session('expired', 'expired', new Date('2026-10-14')), session('newer-pending', 'pending', new Date('2026-10-10'))];
    expect(sortVisitSessions(records).map(item => item.id)).toEqual(['newer-pending', 'older-pending', 'completed', 'expired']);
    expect(records[0].id).toBe('completed');
  });

  it('does not pin sessions that already have a checkout time', () => {
    const records = [session('checked-out', 'pending', new Date('2026-10-15'), new Date('2026-10-16')),
      session('checked-in', 'pending', new Date('2026-10-01'))];
    expect(sortVisitSessions(records).map(item => item.id)).toEqual(['checked-in', 'checked-out']);
  });

  it('accepts Firestore timestamps and retains input order when dates tie', () => {
    const timestamp = { toDate: () => new Date('2026-10-15') } as unknown as Date;
    const records = [session('first', 'pending', timestamp), session('second', 'pending', new Date('2026-10-15'))];
    expect(sortVisitSessions(records).map(item => item.id)).toEqual(['first', 'second']);
    expect(sortVisitSessions([])).toEqual([]);
  });
});
