import * as sdk from 'firebase/firestore';
import { recordFirestoreOperation as record } from './monitoringQueue';
export * from 'firebase/firestore';

const paths = new WeakMap<object, string>();
const name = (ref: any): string => paths.get(ref) || ref?.path?.split('/').filter((_: string, i: number) => i % 2 === 0).join('/') || 'unknown';
const snapshotReads = (snapshot: any) => snapshot.size ?? 1;
const wrap = (fn: any, kind: 'reads' | 'writes' | 'deletes' | 'cacheReads') => async (ref: any, ...args: any[]) => {
  try {
    const operation = typeof fn === 'string' ? (sdk as any)[fn] : fn;
    const result = await operation(ref, ...args);
    record(name(ref), kind === 'reads' && (result as any)?.metadata?.fromCache ? 'cacheReads' : kind,
      kind === 'reads' || kind === 'cacheReads' ? snapshotReads(result) : 1);
    return result;
  } catch (error) { record(name(ref), 'failures'); throw error; }
};
export const query: typeof sdk.query = ((ref: any, ...constraints: any[]) => {
  const result = (sdk.query as any)(ref, ...constraints);
  paths.set(result, name(ref));
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
  const index = args.findIndex(value => typeof value === 'function' || (value && typeof value.next === 'function'));
  const observer = args[index];
  const next = typeof observer === 'function' ? observer : observer?.next?.bind(observer);
  const report = (snapshot: any) => {
    const count = snapshot.docChanges ? snapshot.docChanges().length : 1;
    record(name(ref), snapshot.metadata.fromCache ? 'cacheReads' : 'reads', count);
    next?.(snapshot);
  };
  if (typeof observer === 'function') {
    args[index] = report;
    const error = args[index + 1];
    args[index + 1] = (reason: unknown) => { record(name(ref), 'failures'); error?.(reason); };
  } else if (observer) {
    args[index] = { ...observer, next: report, error: (reason: unknown) => { record(name(ref), 'failures'); observer.error?.(reason); } };
  }
  return (sdk.onSnapshot as any)(ref, ...args);
}) as typeof sdk.onSnapshot;

function instrumentWriter(writer: any, writes: Array<[string, 'writes' | 'deletes']>) {
  const proxy = new Proxy(writer, {
    get(target, key) {
      if (key === 'get') return wrap(target.get.bind(target), 'reads');
      if (key === 'commit') return async () => {
        try { await target.commit(); writes.forEach(([collection, kind]) => record(collection, kind)); }
        catch (error) { writes.forEach(([collection]) => record(collection, 'failures')); throw error; }
      };
      if (['set', 'update', 'delete'].includes(String(key))) return (ref: any, ...args: any[]) => {
        target[key](ref, ...args); writes.push([name(ref), key === 'delete' ? 'deletes' : 'writes']); return proxy;
      };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return proxy;
}
export const runTransaction: typeof sdk.runTransaction = (async (db: any, callback: any, options: any) => {
  let writes: Array<[string, 'writes' | 'deletes']> = [];
  try {
    const result = await sdk.runTransaction(db, tx => {
      writes = [];
      return callback(instrumentWriter(tx, writes));
    }, options);
    writes.forEach(([collection, kind]) => record(collection, kind));
    return result;
  } catch (error) {
    new Set(writes.map(([collection]) => collection)).forEach(collection => record(collection, 'failures'));
    throw error;
  }
}) as typeof sdk.runTransaction;
export const writeBatch: typeof sdk.writeBatch = ((db: any) => {
  const writes: Array<[string, 'writes' | 'deletes']> = [];
  const batch = sdk.writeBatch(db);
  return instrumentWriter(batch, writes);
}) as typeof sdk.writeBatch;
