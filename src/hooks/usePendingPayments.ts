import { useCallback, useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from '../services/firebase/monitoredFirestore';
import { db } from '../config/firebase';
import { GLOBAL_COLLECTIONS as C } from '../config/globalCollections';
import { toDateOrNull } from '../services/firebase/core/sanitize';

export interface PendingPayment {
  id: string;
  kind: 'manual_membership' | 'manual_reload' | 'online_membership' | 'online_reload';
  status: string;
  orderId?: string;
  recordId?: string;
  reloadAmount?: number;
  total?: number;
  storeId?: string;
}

export function selectPendingPayment(orders: Array<Record<string, any>>, reloads: Array<Record<string, any>>): PendingPayment | null {
  const oldest = (a: Record<string, any>, b: Record<string, any>) =>
    (toDateOrNull(a.createdAt)?.getTime() ?? 0) - (toDateOrNull(b.createdAt)?.getTime() ?? 0)
      || String(a.id).localeCompare(String(b.id));
  const order = [...orders].filter(item => ['pending', 'creating'].includes(item.status)).sort(oldest)[0];
  if (order) return {
    id: order.id, orderId: order.id, kind: order.paymentMethod === 'manual' ? 'manual_membership' : 'online_membership',
    status: order.status, reloadAmount: order.reloadAmount, total: Number(order.totalCents) / 100, storeId: order.storeId,
    recordId: reloads.find(item => item.membershipOrderId === order.id)?.id,
  };
  const reload = [...reloads].filter(item => item.status === 'pending').sort(oldest)[0];
  if (!reload) return null;
  return { id: reload.id, recordId: reload.id, orderId: reload.membershipOrderId, status: reload.status,
    kind: reload.billplzId ? 'online_reload' : reload.membershipOrderId ? 'manual_membership' : 'manual_reload',
    total: reload.requestedAmount, storeId: reload.storeId };
}

// Cached absence is not proof that there is no payable order. Wait for both server snapshots.
export function usePendingPayments(userId?: string) {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState({ userId, loading: Boolean(userId), error: false,
    orders: [] as Array<Record<string, any>>, reloads: [] as Array<Record<string, any>> });
  const retry = useCallback(() => setVersion(value => value + 1), []);
  useEffect(() => {
    let alive = true;
    const sources = { orders: false, reloads: false };
    const errors = { orders: false, reloads: false };
    setState({ userId, loading: Boolean(userId), error: false, orders: [], reloads: [] });
    if (!userId) return () => { alive = false; };
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const updateDeadline = (ready: boolean) => {
      if (ready) {
        clearTimeout(timer);
        timer = undefined;
        timedOut = false;
      } else if (timer === undefined && !timedOut) {
        timer = setTimeout(() => {
          timer = undefined;
          timedOut = true;
          if (alive) setState(value => ({ ...value, loading: false, error: true }));
        }, 12000);
      }
    };
    updateDeadline(false);
    const listen = (source: 'orders' | 'reloads', collectionId: string, statuses: string[]) => onSnapshot(
      query(collection(db, collectionId), where('userId', '==', userId), where('status', 'in', statuses)),
      { includeMetadataChanges: true },
      snapshot => {
        if (!alive) return;
        sources[source] = !snapshot.metadata.fromCache;
        errors[source] = false;
        const ready = sources.orders && sources.reloads;
        updateDeadline(ready);
        setState(value => ({ ...value, [source]: snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })),
          loading: !ready && !timedOut && !errors.orders && !errors.reloads,
          error: timedOut || errors.orders || errors.reloads }));
      },
      () => {
        if (!alive) return;
        errors[source] = true;
        setState(value => ({ ...value, loading: false, error: true }));
      },
    );
    const unsubscribers = [listen('orders', C.MEMBERSHIP_PAYMENT_STATUSES, ['creating', 'pending']),
      listen('reloads', C.RELOAD_RECORDS, ['pending'])];
    return () => { alive = false; clearTimeout(timer); unsubscribers.forEach(unsubscribe => unsubscribe()); };
  }, [userId, version]);
  const current = state.userId === userId ? state : { userId, loading: Boolean(userId), error: false, orders: [], reloads: [] };
  return { ...current, request: selectPendingPayment(current.orders, current.reloads), retry };
}
