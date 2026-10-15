import { doc, onSnapshot } from './monitoredFirestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS as C } from '../../config/globalCollections';

export interface RedemptionStatsState {
  userId: string;
  status: 'loading' | 'ready' | 'initializing' | 'error';
  completedQuantity: number;
  pendingQuantity: number;
}

export function subscribeToRedemptionStats(userId: string, listener: (state: RedemptionStatsState) => void) {
  let active = true, metadataReady: boolean | null = null, statsReceived = false, failed = false;
  let completedQuantity = 0, pendingQuantity = 0;
  const emit = () => {
    if (!active) return;
    const status = failed ? 'error' : metadataReady === false ? 'initializing'
      : metadataReady === true && statsReceived ? 'ready' : 'loading';
    listener({ userId, status, completedQuantity, pendingQuantity });
  };
  const onError = () => { failed = true; emit(); };
  const stopMeta = onSnapshot(doc(db, C.REDEMPTION_STATS_META, 'default'), { includeMetadataChanges: true }, snapshot => {
    metadataReady = snapshot.data()?.ready === true;
    emit();
  }, onError);
  const stopStats = onSnapshot(doc(db, C.REDEMPTION_STATS, userId), { includeMetadataChanges: true }, snapshot => {
    if (!snapshot.exists() && snapshot.metadata.fromCache) { statsReceived = false; emit(); return; }
    const value = snapshot.data();
    completedQuantity = value?.completedQuantity ?? 0;
    pendingQuantity = value?.pendingQuantity ?? 0;
    if ((value && value.version !== 1)
      || [completedQuantity, pendingQuantity].some(count => !Number.isSafeInteger(count) || count < 0)) {
      onError(); return;
    }
    statsReceived = true;
    emit();
  }, onError);
  return () => { active = false; stopMeta(); stopStats(); };
}
