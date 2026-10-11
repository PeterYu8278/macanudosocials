import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ listeners: [] as any[] }));
vi.mock('../config/firebase', () => ({ db: {} }));
vi.mock('../services/firebase/monitoredFirestore', () => ({
  collection: (_: unknown, name: string) => ({ name }),
  where: (...args: any[]) => args,
  query: (collection: any, ...filters: any[]) => ({ ...collection, filters }),
  onSnapshot: (query: any, options: any, next: any, error: any) => {
    const listener = { query, options, next, error, unsubscribe: vi.fn() }; m.listeners.push(listener);
    return listener.unsubscribe;
  },
}));
import { selectPendingPayment, usePendingPayments } from './usePendingPayments';
const emit = (index: number, docs: any[] = [], fromCache = false) => act(() => m.listeners[index].next({
  metadata: { fromCache }, docs: docs.map(data => ({ id: data.id, data: () => data })),
}));
describe('direct pending-payment listeners', () => {
  beforeEach(() => { m.listeners = []; vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it('queries only this user and waits for both server snapshots', () => {
    const { result } = renderHook(() => usePendingPayments('member'));
    expect(m.listeners).toHaveLength(2);
    expect(m.listeners[0].query.name).toBe('_membershipPaymentStatuses');
    expect(m.listeners.every(listener => listener.query.filters[0][2] === 'member')).toBe(true);
    emit(0, [], true); emit(1, [], true);
    expect(result.current.loading).toBe(true);
    emit(0); expect(result.current.loading).toBe(true);
    emit(1); expect(result.current.loading).toBe(false);
    expect(result.current.request).toBeNull();
  });
  it('deduplicates an order and its reload record and updates after approval', () => {
    const { result } = renderHook(() => usePendingPayments('member'));
    emit(0, [{ id: 'order', status: 'pending', paymentMethod: 'manual', totalCents: 29900 }]);
    emit(1, [{ id: 'reload', status: 'pending', membershipOrderId: 'order' }]);
    expect(result.current.request).toMatchObject({ kind: 'manual_membership', orderId: 'order', recordId: 'reload', total: 299 });
    emit(0); emit(1);
    expect(result.current.request).toBeNull();
  });
  it('detects creating and pending online orders without a reload record', () => {
    const { result } = renderHook(() => usePendingPayments('member'));
    emit(0, [{ id: 'order', status: 'creating', totalCents: 29900 }]); emit(1);
    expect(result.current.request).toMatchObject({ kind: 'online_membership', status: 'creating' });
    emit(0, [{ id: 'order', status: 'pending', paymentMethod: 'billplz' }]);
    expect(result.current.request?.status).toBe('pending');
  });
  it('recognizes legacy manual packages and ordinary reloads', () => {
    expect(selectPendingPayment([], [{ id: 'reload', status: 'pending', membershipOrderId: 'old' }])?.kind).toBe('manual_membership');
    expect(selectPendingPayment([], [{ id: 'reload', status: 'pending' }])?.kind).toBe('manual_reload');
    expect(selectPendingPayment([], [{ id: 'reload', status: 'pending', billplzId: 'bill' }])?.kind).toBe('online_reload');
    expect(selectPendingPayment([{ id: 'old', status: 'fulfilled' }], [{ id: 'old', status: 'rejected' }])).toBeNull();
  });
  it('does not interpret a failed listener as no pending payments and supports retry', () => {
    const { result } = renderHook(() => usePendingPayments('member'));
    act(() => m.listeners[0].error(new Error('permission denied'))); emit(1);
    expect(result.current.error).toBe(true);
    act(() => result.current.retry());
    expect(m.listeners[0].unsubscribe).toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
    emit(2); emit(3);
    expect(result.current.error).toBe(false);
  });
  it('times out when only empty cached results are available', () => {
    const { result } = renderHook(() => usePendingPayments('member'));
    emit(0, [], true); emit(1, [], true);
    act(() => vi.advanceTimersByTime(12000));
    expect(result.current).toMatchObject({ loading: false, error: true });
    emit(0, [], true);
    expect(result.current).toMatchObject({ loading: false, error: true });
    emit(0); emit(1);
    expect(result.current).toMatchObject({ loading: false, error: false });
  });
  it('bounds the wait after a previously connected listener becomes cached', () => {
    const { result } = renderHook(() => usePendingPayments('member'));
    emit(0); emit(1);
    emit(0, [], true);
    expect(result.current.loading).toBe(true);
    act(() => vi.advanceTimersByTime(12000));
    expect(result.current).toMatchObject({ loading: false, error: true });
  });
  it('clears data on account switch and ignores callbacks from old listeners', () => {
    const { result, rerender, unmount } = renderHook(({ id }) => usePendingPayments(id), { initialProps: { id: 'first' } });
    emit(0, [{ id: 'old', status: 'pending' }]); emit(1);
    rerender({ id: 'second' });
    expect(result.current.request).toBeNull();
    expect(m.listeners[0].unsubscribe).toHaveBeenCalled();
    emit(0, [{ id: 'late', status: 'pending' }]);
    expect(result.current.request).toBeNull();
    unmount();
    expect(m.listeners[2].unsubscribe).toHaveBeenCalled();
  });
});
