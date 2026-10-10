import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { FieldValue, getFirestore as rawFirestore, initializeFirestore as rawInitialize } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS } from '../../../src/config/globalCollections';

export interface MetricRow {
  collection: string; feature: string;
  reads: number; writes: number; deletes: number; failures: number; cacheReads: number;
}
const context = new AsyncLocalStorage<{ feature: string; rows: Map<string, MetricRow> }>();
const counters = ['reads', 'writes', 'deletes', 'failures', 'cacheReads'] as const;
export function record(collection: string, kind: typeof counters[number], count = 1) {
  const scope = context.getStore();
  if (!scope || collection.startsWith('_firestoreMetric')) return;
  if (!scope.rows.has(collection) && scope.rows.size >= 100) return;
  const row = scope.rows.get(collection) ?? { collection, feature: scope.feature, reads: 0, writes: 0, deletes: 0, failures: 0, cacheReads: 0 };
  row[kind] += count; scope.rows.set(collection, row);
}
export async function persistMetrics(rows: MetricRow[], source: 'frontend' | 'backend') {
  if (!rows.length) return;
  const db = rawFirestore();
  const date = new Date().toISOString().slice(0, 10);
  const batch = db.batch();
  for (const row of rows) {
    const id = createHash('sha256').update(`${date}:${source}:${row.collection}:${row.feature}`).digest('hex');
    const values: Record<string, unknown> = { date, source, collection: row.collection, feature: row.feature, updatedAt: FieldValue.serverTimestamp() };
    counters.forEach(key => { values[key] = FieldValue.increment(row[key]); });
    batch.set(db.collection(GLOBAL_COLLECTIONS.FIRESTORE_METRICS).doc(id), values, { merge: true });
  }
  await batch.commit();
}
export async function withFirestoreMonitoring<T>(feature: string, work: () => Promise<T>): Promise<T> {
  if (feature === 'firestore-monitoring' || process.env.NODE_ENV === 'test' || process.env.FIRESTORE_MONITORING_ENABLED === 'false') return work();
  return context.run({ feature, rows: new Map() }, async () => {
    try { return await work(); }
    finally {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // A quota incident must not hold authentication/payment responses in SDK retries.
        await Promise.race([
          persistMetrics([...context.getStore()!.rows.values()], 'backend'),
          new Promise<void>(resolve => { timer = setTimeout(resolve, 1500); }),
        ]);
      }
      catch { /* Best effort: do not change the business response on quota failure. */ }
      finally { if (timer) clearTimeout(timer); }
    }
  });
}

const original = new WeakMap<object, object>();
const unwrap = (value: any) => value && typeof value === 'object' ? original.get(value) ?? value : value;
const collectionPath = (value: any): string => value?.path?.split('/').filter((_: string, index: number) => index % 2 === 0).join('/')
  || value?._queryOptions?.collectionId || 'unknown';

function observeSnapshot(snapshot: any): any {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  return new Proxy(snapshot, {
    get(target, key) {
      if (key === 'ref') return instrument(target.ref);
      if (key === 'docs') return target.docs.map(observeSnapshot);
      if (key === 'forEach') return (callback: (doc: any) => void, thisArg?: any) =>
        target.forEach((doc: any) => callback.call(thisArg, observeSnapshot(doc)));
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
function instrument(target: any, pending?: Array<[string, 'writes' | 'deletes']>): any {
  const proxy = new Proxy(target, {
    get(object, key) {
      const fn = object[key];
      if (['parent', 'firestore'].includes(String(key)) && fn && typeof fn === 'object') return instrument(fn);
      if (typeof fn !== 'function') return fn;
      return (...args: any[]) => {
        const collection = collectionPath(object);
        if (key === 'runTransaction') {
          let writes: Array<[string, 'writes' | 'deletes']> = [];
          return fn.call(object, (tx: any) => { writes = []; return args[0](instrument(tx, writes)); }, ...args.slice(1))
            .then((result: any) => { writes.forEach(([name, kind]) => record(name, kind)); return result; })
            .catch((error: unknown) => { new Set(writes.map(([name]) => name)).forEach(name => record(name, 'failures')); throw error; });
        }
        if (key === 'batch') return instrument(fn.apply(object, args), []);
        if (key === 'commit' && pending) return Promise.resolve().then(() => fn.apply(object, args)).then((result: any) => {
          pending.forEach(([name, kind]) => record(name, kind)); return result;
        }).catch((error: unknown) => { pending.forEach(([name]) => record(name, 'failures')); throw error; });
        const isRead = key === 'get' || key === 'getAll';
        const isWrite = ['set', 'create', 'update', 'delete', 'add'].includes(String(key));
        const collectionName = pending && args[0] ? collectionPath(args[0]) : collection;
        let result;
        try { result = fn.apply(object, args.map(unwrap)); }
        catch (error) { if (isRead || isWrite) record(collectionName, 'failures'); throw error; }
        if (isWrite && pending) { pending.push([collectionName, key === 'delete' ? 'deletes' : 'writes']); return proxy; }
        if ((isRead || isWrite) && result?.then) return result.then((value: any) => {
          if (Array.isArray(value)) value.forEach((snapshot: any) => record(collectionPath(snapshot.ref), 'reads'));
          else record(collectionName, isRead ? 'reads' : key === 'delete' ? 'deletes' : 'writes', isRead ? value.size ?? 1 : 1);
          return isRead ? Array.isArray(value) ? value.map(observeSnapshot) : observeSnapshot(value) : value;
        }).catch((error: unknown) => { record(collectionName, 'failures'); throw error; });
        if (result && typeof result === 'object' && (result.path || result.where || result._queryOptions || result.commit)) return instrument(result, pending);
        return result;
      };
    },
  });
  original.set(proxy, target); return proxy;
}
export { FieldValue };
export * from 'firebase-admin/firestore';
export const getFirestore: typeof rawFirestore = ((...args: any[]) => instrument((rawFirestore as any)(...args))) as typeof rawFirestore;
export const initializeFirestore: typeof rawInitialize = ((...args: any[]) => instrument((rawInitialize as any)(...args))) as typeof rawInitialize;
