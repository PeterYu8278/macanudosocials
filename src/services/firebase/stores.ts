import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  Timestamp
} from '@/services/firebase/monitoredFirestore';
import { db } from '../../config/firebase';
import type { Store } from '../../types';
import { convertFirestoreTimestamps } from './auth';

const STORES_COLLECTION = 'stores';

const DEFAULT_STORE_ID = 'default';

const ensureDefaultStore = async () => {
  const ref = doc(db, STORES_COLLECTION, DEFAULT_STORE_ID);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const now = Timestamp.fromDate(new Date());
    await setDoc(ref, {
      name: 'HQ',
      status: 'active',
      address: '',
      phone: '',
      email: '',
      createdAt: now,
      updatedAt: now,
    });
  }
};

/**
 * 获取所有门店
 */
export const getAllStores = async () => {
  try {
    await ensureDefaultStore();
    const q = query(collection(db, STORES_COLLECTION));
    const querySnapshot = await getDocs(q);
    const stores = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...convertFirestoreTimestamps(doc.data())
    })) as Store[];
    // HQ (id: 'default') first, then by createdAt desc
    return stores.sort((a, b) => {
      if (a.id === 'default') return -1;
      if (b.id === 'default') return 1;
      const aTime = (a as any).createdAt?.getTime?.() ?? 0;
      const bTime = (b as any).createdAt?.getTime?.() ?? 0;
      return bTime - aTime;
    });
  } catch (error) {
    console.error('[Stores Service] getAllStores error:', error);
    throw error;
  }
};

/**
 * 获取活跃门店
 */
export const getActiveStores = async () => {
  try {
    const q = query(collection(db, STORES_COLLECTION), where('status', '==', 'active'));
    const querySnapshot = await getDocs(q);
    const stores = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...convertFirestoreTimestamps(doc.data())
    })) as Store[];
    return stores.sort((a, b) => {
      if (a.id === 'default') return -1;
      if (b.id === 'default') return 1;
      const aTime = (a as any).createdAt?.getTime?.() ?? 0;
      const bTime = (b as any).createdAt?.getTime?.() ?? 0;
      return bTime - aTime;
    });
  } catch (error) {
    console.error('[Stores Service] getActiveStores error:', error);
    throw error;
  }
};

/**
 * 根据 ID 获取门店
 */
export const getStoreById = async (storeId: string) => {
  try {
    const docRef = doc(db, STORES_COLLECTION, storeId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return {
        id: docSnap.id,
        ...convertFirestoreTimestamps(docSnap.data())
      } as Store;
    }
    return null;
  } catch (error) {
    console.error('[Stores Service] getStoreById error:', error);
    throw error;
  }
};

// Remove undefined values – Firestore rejects them
const stripUndefined = (obj: Record<string, any>): Record<string, any> => {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
};

/**
 * 创建门店
 */
export const createStore = async (storeData: Omit<Store, 'id' | 'createdAt' | 'updatedAt'>) => {
  try {
    const now = new Date();
    const docRef = await addDoc(collection(db, STORES_COLLECTION), {
      ...stripUndefined(storeData as Record<string, any>),
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now)
    });
    return { success: true, id: docRef.id };
  } catch (error: any) {
    console.error('[Stores Service] createStore error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 更新门店
 */
export const updateStore = async (storeId: string, storeData: Partial<Omit<Store, 'id' | 'createdAt' | 'updatedAt'>>) => {
  try {
    const docRef = doc(db, STORES_COLLECTION, storeId);
    await updateDoc(docRef, {
      ...stripUndefined(storeData as Record<string, any>),
      updatedAt: Timestamp.fromDate(new Date())
    });
    return { success: true };
  } catch (error: any) {
    console.error('[Stores Service] updateStore error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 删除门店
 */
export const deleteStore = async (storeId: string) => {
  try {
    const docRef = doc(db, STORES_COLLECTION, storeId);
    await deleteDoc(docRef);
    return { success: true };
  } catch (error: any) {
    console.error('[Stores Service] deleteStore error:', error);
    return { success: false, error: error.message };
  }
};
