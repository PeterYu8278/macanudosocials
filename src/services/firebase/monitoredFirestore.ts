import * as sdk from 'firebase/firestore';
import { captureMonitoringContext, recordFirestoreOperation as record, type MonitoringContext } from './monitoringQueue';
import { isMonitoringOperation, type MonitoringOperation } from './monitoringMetrics';
export * from 'firebase/firestore';
export { MONITORING_OPERATIONS, type MonitoringOperation } from './monitoringMetrics';

const operations = new WeakMap<object, MonitoringOperation>();
/** Annotate a ref with a fixed label; never pass user data or query values. */
export function withMonitoringOperation<T extends object>(ref: T, operation: MonitoringOperation): T {
  if (isMonitoringOperation(operation)) operations.set(ref, operation);
  return ref;
}

const paths = new WeakMap<object, string>();
const name = (ref: any): string => paths.get(ref) || ref?.path?.split('/').filter((_: string, i: number) => i % 2 === 0).join('/') || 'unknown';
const snapshotReads = (snapshot: any) => snapshot.size ?? 1;
const wrap = (fn: any, kind: 'reads' | 'writes' | 'deletes' | 'cacheReads') => async (ref: any, ...args: any[]) => {
  const attribution = captureMonitoringContext(operations.get(ref));
  const started = performance.now();
  const metrics = () => ({ requests: 1, readRequests: kind === 'reads' || kind === 'cacheReads' ? 1 : 0,
    latencyMs: Math.max(0, Math.round(performance.now() - started)), latencySamples: 1 });
  try {
    const operation = typeof fn === 'string' ? (sdk as any)[fn] : fn;
    const result = await operation(ref, ...args);
    record(name(ref), kind === 'reads' && (result as any)?.metadata?.fromCache ? 'cacheReads' : kind,
      kind === 'reads' || kind === 'cacheReads' ? snapshotReads(result) : 1, attribution, metrics());
    return result;
  } catch (error) { record(name(ref), 'failures', 1, attribution, metrics()); throw error; }
};
export const query: typeof sdk.query = ((ref: any, ...constraints: any[]) => {
  const result = (sdk.query as any)(ref, ...constraints);
  paths.set(result, name(ref));
  const operation = operations.get(ref);
  if (operation) operations.set(result, operation);
  return result;
}) as typeof sdk.query;
export const collectionGroup: typeof sdk.collectionGroup = ((db: any, id: string) => {
  const result = sdk.collectionGroup(db, id); paths.set(result, id); return result;
}) as typeof sdk.collectionGroup;
export const getDoc = wrap('getDoc', 'reads') as typeof sdk.getDoc;
export const getDocs = wrap('getDocs', 'reads') as typeof sdk.getDocs;
export const getDocFromServer = wrap('getDocFromServer', 'reads') as typeof sdk.getDocFromServer;
export const getDocsFromServer = wrap('getDocsFromServer', 'reads') as typeof sdk.getDocsFromServer;
export const getDocFromCache = wrap('getDocFromCache', 'cacheReads') as typeof sdk.getDocFromCache;
export const getDocsFromCache = wrap('getDocsFromCache', 'cacheReads') as typeof sdk.getDocsFromCache;
export const setDoc = wrap('setDoc', 'writes') as typeof sdk.setDoc;
export const addDoc = wrap('addDoc', 'writes') as typeof sdk.addDoc;
export const updateDoc = wrap('updateDoc', 'writes') as typeof sdk.updateDoc;
export const deleteDoc = wrap('deleteDoc', 'deletes') as typeof sdk.deleteDoc;
export const onSnapshot: typeof sdk.onSnapshot = ((ref: any, ...args: any[]) => {
  const attribution = captureMonitoringContext(operations.get(ref));
  const started = performance.now();
  let first = true;
  // Cache and server have separate initial snapshots; neither changes legacy read counts.
  const seen = new Set<boolean>();
  const initialMetrics = () => {
    if (!first) return {};
    first = false;
    return { requests: 1, readRequests: 1, latencyMs: Math.max(0, Math.round(performance.now() - started)), latencySamples: 1 };
  };
  const failure = () => record(name(ref), 'failures', 1, attribution, initialMetrics());
  const index = args.findIndex(value => typeof value === 'function' || (value && typeof value.next === 'function'));
  const observer = args[index];
  const next = typeof observer === 'function' ? observer : observer?.next?.bind(observer);
  const report = (snapshot: any) => {
    const count = snapshot.docChanges ? snapshot.docChanges().length : 1;
    const cached = !!snapshot.metadata.fromCache;
    const initial = !seen.has(cached);
    seen.add(cached);
    record(name(ref), cached ? 'cacheReads' : 'reads', count, attribution, {
      ...initialMetrics(),
      [initial ? 'listenerInitialSnapshots' : 'listenerChangeSnapshots']: 1,
      ...(!cached ? { [initial ? 'listenerInitialReads' : 'listenerChangeReads']: count } : {}),
    });
    next?.(snapshot);
  };
  if (typeof observer === 'function') {
    args[index] = report;
    const error = args[index + 1];
    args[index + 1] = (reason: unknown) => { failure(); error?.(reason); };
  } else if (observer) {
    args[index] = { ...observer, next: report, error: (reason: unknown) => { failure(); observer.error?.(reason); } };
  }
  try { return (sdk.onSnapshot as any)(ref, ...args); }
  catch (error) { failure(); throw error; }
}) as typeof sdk.onSnapshot;

type PendingWrite = [string, 'writes' | 'deletes', MonitoringContext];
function instrumentWriter(writer: any, writes: PendingWrite[], attribution: MonitoringContext) {
  const proxy = new Proxy(writer, {
    get(target, key) {
      if (key === 'get') return wrap(target.get.bind(target), 'reads');
      if (key === 'commit') return async () => {
        const started = performance.now();
        const metrics = (index: number) => index === 0 ? { requests: 1, latencySamples: 1,
          latencyMs: Math.max(0, Math.round(performance.now() - started)) } : {};
        try { await target.commit(); writes.forEach(([collection, kind, scope], index) => record(collection, kind, 1, scope, metrics(index))); }
        catch (error) { writes.forEach(([collection, , scope], index) => record(collection, 'failures', 1, scope, metrics(index))); throw error; }
      };
      if (['set', 'update', 'delete'].includes(String(key))) return (ref: any, ...args: any[]) => {
        target[key](ref, ...args);
        writes.push([name(ref), key === 'delete' ? 'deletes' : 'writes',
          { ...attribution, ...(operations.has(ref) ? { operation: operations.get(ref) } : {}) }]);
        return proxy;
      };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return proxy;
}
export const runTransaction: typeof sdk.runTransaction = (async (db: any, callback: any, options: any) => {
  let writes: PendingWrite[] = [];
  const attribution = captureMonitoringContext();
  const started = performance.now();
  const metrics = (index: number) => index === 0 ? { requests: 1, latencySamples: 1,
    latencyMs: Math.max(0, Math.round(performance.now() - started)) } : {};
  try {
    const result = await sdk.runTransaction(db, tx => {
      writes = [];
      return callback(instrumentWriter(tx, writes, attribution));
    }, options);
    writes.forEach(([collection, kind, scope], index) => record(collection, kind, 1, scope, metrics(index)));
    return result;
  } catch (error) {
    [...new Set(writes.map(([collection]) => collection))].forEach((collection, index) => record(collection, 'failures', 1, attribution, metrics(index)));
    throw error;
  }
}) as typeof sdk.runTransaction;
export const writeBatch: typeof sdk.writeBatch = ((db: any) => {
  const writes: PendingWrite[] = [];
  const batch = sdk.writeBatch(db);
  return instrumentWriter(batch, writes, captureMonitoringContext());
}) as typeof sdk.writeBatch;
