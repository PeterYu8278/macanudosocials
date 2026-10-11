// 充值记录服务
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  limit,
  startAfter,
  Timestamp,
  type QuerySnapshot,
  type DocumentData,
  type QueryDocumentSnapshot
} from '@/services/firebase/monitoredFirestore';
import { auth, db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import type { ReloadRecord, User } from '../../types';
import { WALLET_RELOAD_OPTIONS } from '../../utils/reloadAmount';
import i18n from 'i18next';

// 充值汇率（1 RM = 多少积分）
const RELOAD_EXCHANGE_RATE = 1; // 1 RM = 1 积分（可根据配置调整）

/**
 * 创建充值记录
 */
export const createReloadRecord = async (
  userId: string,
  requestedAmount: number, // RM
  userName?: string,
  storeId?: string,
  billplzId?: string,
  options?: { manual?: boolean }
): Promise<{ success: boolean; recordId?: string; error?: string }> => {
  try {
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0
      || Math.round(requestedAmount * 100) / 100 !== requestedAmount
      || (options?.manual && billplzId)) return { success: false, error: i18n.t('annualPassPayment.reviewFailed') };
    if (!billplzId) {
      const currentUser = auth.currentUser;
      if (!currentUser) return { success: false, error: i18n.t('auth.pleaseLogin') };
      const response = await fetch('/.netlify/functions/reload-review', {
        method: 'POST', headers: { Authorization: `Bearer ${await currentUser.getIdToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', userId, amount: requestedAmount, storeId, operatorManual: options?.manual === true }),
      });
      const result = await response.json();
      return result.success ? { success: true, recordId: result.recordId }
        : { success: false, error: i18n.t('annualPassPayment.reviewFailed') };
    }
    if (!WALLET_RELOAD_OPTIONS.includes(requestedAmount) || !storeId) {
      return { success: false, error: i18n.t('annualPassPayment.reviewFailed') };
    }

    const userDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.USERS, userId));
    if (!userDoc.exists()) {
      return { success: false, error: '用户不存在' };
    }

    const userData = userDoc.data() as User;
    const pointsEquivalent = Math.round(requestedAmount * RELOAD_EXCHANGE_RATE);

    const recordData: Omit<ReloadRecord, 'id'> = {
      userId,
      userName: userName || userData.displayName,
      requestedAmount,
      pointsEquivalent,
      status: 'pending',
      ...(storeId !== undefined && { storeId }),
      ...(billplzId !== undefined && { billplzId }),
      ...(billplzId && { adminNotes: `Billplz Online Reload (ID: ${billplzId})` }),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const now = new Date();
    const docRef = await addDoc(collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS), {
      ...recordData,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now)
    });

    return { success: true, recordId: docRef.id };
  } catch (error: any) {
    return { success: false, error: error.message || '创建充值记录失败' };
  }
};

/**
 * 验证充值记录（管理员操作）
 */
async function reviewReload(recordId: string, action: 'approve' | 'reject' | 'cancel', proof?: string, notes?: string, actualAmount?: number, creditOnly?: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return { success: false, error: 'UNAUTHENTICATED' };
    const response = await fetch('/.netlify/functions/reload-review', {
      method: 'POST', headers: { Authorization: `Bearer ${await currentUser.getIdToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId, action, proof, notes, actualAmount, creditOnly }),
    });
    const result = await response.json();
    return result.success ? { success: true } : { success: false, error: i18n.t('annualPassPayment.reviewFailed') };
  } catch {
    return { success: false, error: i18n.t('annualPassPayment.reviewFailed') };
  }
}

export const verifyReloadRecord = async (
  recordId: string, _verifiedBy: string, verificationProof?: string, adminNotes?: string,
  _verifiedByName?: string, actualAmount?: number, creditOnly?: boolean
) => reviewReload(recordId, 'approve', verificationProof, adminNotes, actualAmount, creditOnly);

export const cancelReloadRecord = async (recordId: string, _userId: string) =>
  reviewReload(recordId, 'cancel');

export const rejectReloadRecord = async (
  recordId: string, _rejectedBy: string, adminNotes?: string, _verifiedByName?: string
) => reviewReload(recordId, 'reject', undefined, adminNotes);

/**
 * 获取用户的充值记录
 */
export const getUserReloadRecords = async (
  userId: string,
  limitCount: number = 20
): Promise<ReloadRecord[]> => {
  try {
    const q = query(
      collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        verifiedAt: data.verifiedAt?.toDate?.() || data.verifiedAt,
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
        updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
      } as ReloadRecord;
    });
  } catch (error: any) {
    console.error('[getUserReloadRecords] 查询失败，尝试不使用orderBy:', error);
    
    // 如果是因为缺少索引而失败，尝试不使用orderBy重新查询
    try {
      const q = query(
        collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
        where('userId', '==', userId),
        limit(limitCount)
      );

      const snapshot = await getDocs(q);
      const records = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          verifiedAt: data.verifiedAt?.toDate?.() || data.verifiedAt,
          createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
          updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
        } as ReloadRecord;
      });
      
      // 手动排序
      const sortedRecords = records.sort((a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return bTime - aTime;
      });
      
      return sortedRecords;
    } catch (retryError) {
      console.error('[getUserReloadRecords] 重试查询也失败:', retryError);
      return [];
    }
  }
};

/**
 * 获取用户待验证的充值记录
 */
export const getUserPendingReloadRecord = async (
  userId: string
): Promise<ReloadRecord | null> => {
  try {
    const q = query(
      collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
      where('userId', '==', userId),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
      limit(1)
    );

    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      ...data,
      verifiedAt: data.verifiedAt?.toDate?.() || data.verifiedAt,
      createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
      updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
    } as ReloadRecord;
  } catch (error: any) {
    console.error('[getUserPendingReloadRecord] 查询失败，尝试不使用orderBy:', error);
    
    // 如果是因为缺少索引而失败，尝试不使用orderBy重新查询
    try {
      const q = query(
        collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
        where('userId', '==', userId),
        where('status', '==', 'pending'),
        limit(10)
      );

      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        return null;
      }

      // 手动排序，取最新的
      const records = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          verifiedAt: data.verifiedAt?.toDate?.() || data.verifiedAt,
          createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
          updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
        } as ReloadRecord;
      });
      
      const sortedRecords = records.sort((a, b) => {
        const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
        const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
        return bTime - aTime;
      });
      
      return sortedRecords[0] || null;
    } catch (retryError) {
      console.error('[getUserPendingReloadRecord] 重试查询也失败:', retryError);
      return null;
    }
  }
};

/**
 * 获取所有充值记录（支持状态筛选）
 */
export const getAllReloadRecords = async (
  statusFilter?: 'pending' | 'completed' | 'rejected',
  limitCount?: number
): Promise<ReloadRecord[]> => {
  try {
    const allRecords: ReloadRecord[] = [];
    const batchSize = 1000; // 每次查询1000条
    
    // 如果指定了 limit，直接查询
    if (limitCount !== undefined && limitCount > 0) {
    let q;
    if (statusFilter) {
      q = query(
        collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
        where('status', '==', statusFilter),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
    } else {
      q = query(
        collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
        orderBy('createdAt', 'desc'),
        limit(limitCount)
      );
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        verifiedAt: data.verifiedAt?.toDate?.() || data.verifiedAt,
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
        updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
      } as ReloadRecord;
    });
    }
    
    // 如果没有限制，使用分页查询获取所有记录
    let lastDoc = null;
    let hasMore = true;
    
    while (hasMore) {
      let q;
      if (statusFilter) {
        if (lastDoc) {
          q = query(
            collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
            where('status', '==', statusFilter),
            orderBy('createdAt', 'desc'),
            startAfter(lastDoc),
            limit(batchSize)
          );
        } else {
          q = query(
            collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
            where('status', '==', statusFilter),
            orderBy('createdAt', 'desc'),
            limit(batchSize)
          );
        }
      } else {
        if (lastDoc) {
          q = query(
            collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
            orderBy('createdAt', 'desc'),
            startAfter(lastDoc),
            limit(batchSize)
          );
        } else {
          q = query(
            collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
            orderBy('createdAt', 'desc'),
            limit(batchSize)
          );
        }
      }

      const snapshot: QuerySnapshot<DocumentData> = await getDocs(q);
      const batch = snapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          verifiedAt: data.verifiedAt?.toDate?.() || data.verifiedAt,
          createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
          updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
        } as ReloadRecord;
      });
      
      allRecords.push(...batch);
      
      if (snapshot.docs.length < batchSize) {
        hasMore = false;
      } else {
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
      }
    }
    
    return allRecords;
  } catch (error: any) {
    // 如果查询失败（可能是缺少索引），尝试不使用orderBy
    console.error('[getAllReloadRecords] 查询失败，尝试不使用orderBy:', error);
    try {
      const allRecords: ReloadRecord[] = [];
      const batchSize = 1000;
      
      if (limitCount !== undefined && limitCount > 0) {
      let q;
      if (statusFilter) {
        q = query(
          collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
          where('status', '==', statusFilter),
          limit(limitCount)
        );
      } else {
        q = query(
          collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
          limit(limitCount)
        );
      }
      const snapshot = await getDocs(q);
      const records = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          verifiedAt: data.verifiedAt?.toDate?.() || data.verifiedAt,
          createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
          updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
        } as ReloadRecord;
      });
      // 手动排序
      return records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      
      // 分页获取所有记录
      let lastDoc = null;
      let hasMore = true;
      
      while (hasMore) {
        let q;
        if (statusFilter) {
          if (lastDoc) {
            q = query(
              collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
              where('status', '==', statusFilter),
              startAfter(lastDoc),
              limit(batchSize)
            );
          } else {
            q = query(
              collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
              where('status', '==', statusFilter),
              limit(batchSize)
            );
          }
        } else {
          if (lastDoc) {
            q = query(
              collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
              startAfter(lastDoc),
              limit(batchSize)
            );
          } else {
            q = query(
              collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
              limit(batchSize)
            );
          }
        }
        
        const snapshot: QuerySnapshot<DocumentData> = await getDocs(q);
        const batch = snapshot.docs.map((doc: QueryDocumentSnapshot<DocumentData>) => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            verifiedAt: data.verifiedAt?.toDate?.() || data.verifiedAt,
            createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
            updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
          } as ReloadRecord;
        });
        
        allRecords.push(...batch);
        
        if (snapshot.docs.length < batchSize) {
          hasMore = false;
        } else {
          lastDoc = snapshot.docs[snapshot.docs.length - 1];
        }
      }
      
      // 手动排序
      return allRecords.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (retryError) {
      console.error('[getAllReloadRecords] 重试查询也失败:', retryError);
      return [];
    }
  }
};

/**
 * 获取所有待验证的充值记录
 */
export const getPendingReloadRecords = async (limitCount: number = 50): Promise<ReloadRecord[]> => {
  try {
    const q = query(
      collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        verifiedAt: data.verifiedAt?.toDate?.() || data.verifiedAt,
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
        updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
      } as ReloadRecord;
    });
  } catch (error: any) {
    // 如果查询失败（可能是缺少索引），尝试不使用orderBy
    console.error('[getPendingReloadRecords] 查询失败，尝试不使用orderBy:', error);
    try {
      const q = query(
        collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
        where('status', '==', 'pending'),
        limit(limitCount)
      );
      const snapshot = await getDocs(q);
      const records = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          verifiedAt: data.verifiedAt?.toDate?.() || data.verifiedAt,
          createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
          updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
        } as ReloadRecord;
      });
      // 手动排序
      return records.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (retryError) {
      console.error('[getPendingReloadRecords] 重试查询也失败:', retryError);
      return [];
    }
  }
};
