// 充值记录服务
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  addDoc, 
  setDoc,
  updateDoc,
  deleteDoc,
  query, 
  where, 
  orderBy, 
  limit,
  startAfter,
  Timestamp,
  type QuerySnapshot,
  type DocumentData,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import type { ReloadRecord, User } from '../../types';
import { createPointsRecord } from './pointsRecords';
import { getPointsConfig } from './pointsConfig';
import { calculateReferralPointsFromArray } from '../../utils/referral';

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
  billplzId?: string
): Promise<{ success: boolean; recordId?: string; error?: string }> => {
  try {
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
export const verifyReloadRecord = async (
  recordId: string,
  verifiedBy: string,
  verificationProof?: string,
  adminNotes?: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const recordDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS, recordId));
    if (!recordDoc.exists()) {
      return { success: false, error: '充值记录不存在' };
    }

    const recordData = recordDoc.data();
    const record: ReloadRecord = {
      id: recordDoc.id,
      ...recordData,
      verifiedAt: recordData.verifiedAt?.toDate?.() || recordData.verifiedAt,
      createdAt: recordData.createdAt?.toDate?.() || new Date(recordData.createdAt),
      updatedAt: recordData.updatedAt?.toDate?.() || new Date(recordData.updatedAt)
    } as ReloadRecord;

    if (record.status !== 'pending') {
      return { success: false, error: '该充值记录已处理' };
    }

    // 获取用户信息
    const userDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.USERS, record.userId));
    if (!userDoc.exists()) {
      return { success: false, error: '用户不存在' };
    }

    const userData = userDoc.data() as User;
    const currentPoints = userData.membership?.points || 0;
    let newPoints = currentPoints + record.pointsEquivalent;

    // 如果用户积分为负数，先回填到0或正数
    if (currentPoints < 0) {
      // 负数回填逻辑：新积分 = 原有积分 + 充值积分
      // 例如：-50 + 100 = 50
      newPoints = currentPoints + record.pointsEquivalent;
    }

    // 更新用户积分
    await updateDoc(doc(db, GLOBAL_COLLECTIONS.USERS, record.userId), {
      'membership.points': newPoints,
      updatedAt: Timestamp.fromDate(new Date())
    });

    // 创建积分记录
    const pointsRecord = await createPointsRecord({
      userId: record.userId,
      userName: record.userName,
      type: 'earn',
      amount: record.pointsEquivalent,
      source: 'reload',
      description: `充值 ${record.requestedAmount} RM (${record.pointsEquivalent} 积分)`,
      relatedId: recordId,
      balance: newPoints,
      createdBy: verifiedBy
    });

    const now = new Date();

    // ✅ 检查是否为首次充值，发放首充奖励
    try {
      // 查询该用户是否有其他已完成的充值记录（不包括当前这条）
      const completedReloadsQuery = query(
        collection(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS),
        where('userId', '==', record.userId),
        where('status', '==', 'completed')
      );
      const completedReloadsSnapshot = await getDocs(completedReloadsQuery);
      
      // 如果没有其他已完成的充值记录，说明这是首充
      const isFirstReload = completedReloadsSnapshot.empty;
      
      if (isFirstReload) {
        // 检查用户是否有引荐人
        const referrerId = userData.referral?.referredByUserId;
        
        if (referrerId) {
          // 获取积分配置
          const pointsConfig = await getPointsConfig();
          
          if (pointsConfig?.reload) {
            const referrerReward = pointsConfig.reload.referrerFirstReload || 0;
            const referredReward = pointsConfig.reload.referredFirstReload || 0;
            
            // 1. 给被引荐人（当前用户）增加首充奖励积分
            if (referredReward > 0) {
              const referredNewPoints = newPoints + referredReward;
              await updateDoc(doc(db, GLOBAL_COLLECTIONS.USERS, record.userId), {
                'membership.points': referredNewPoints,
                updatedAt: Timestamp.fromDate(new Date())
              });
              
              // 创建被引荐人的首充奖励积分记录
              await createPointsRecord({
                userId: record.userId,
                userName: record.userName,
                type: 'earn',
                amount: referredReward,
                source: 'reload',
                description: `首次充值奖励`,
                relatedId: recordId,
                balance: referredNewPoints,
                createdBy: verifiedBy
              });
              
              // 更新 newPoints 以便后续更新充值记录时使用正确的余额
              newPoints = referredNewPoints;
              
            }
            
            // 2. 给引荐人增加首充奖励积分
            if (referrerReward > 0) {
              const referrerDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.USERS, referrerId));
              if (referrerDoc.exists()) {
                const referrerData = referrerDoc.data() as User;
                const referrerCurrentPoints = referrerData.membership?.points || 0;
                const referrerNewPoints = referrerCurrentPoints + referrerReward;
                
                // 更新引荐人的 referrals 数组，添加首充奖励信息
                const existingReferrals = referrerData.referral?.referrals || [];
                const referralIndex = existingReferrals.findIndex(
                  (r: any) => (typeof r === 'string' ? r === record.userId : r.userId === record.userId)
                );
                
                const referralData = {
                  userId: record.userId,
                  userName: record.userName,
                  memberId: userData.memberId || null,
                  firstReloadReward: referrerReward,
                  firstReloadDate: Timestamp.fromDate(new Date()),
                  firstReloadRecordId: recordId
                };
                
                let updatedReferrals: any[];
                if (referralIndex >= 0) {
                  // 如果已存在，更新记录（兼容旧数据格式 string）
                  updatedReferrals = [...existingReferrals];
                  updatedReferrals[referralIndex] = {
                    ...(typeof existingReferrals[referralIndex] === 'string' 
                      ? { userId: existingReferrals[referralIndex] } 
                      : existingReferrals[referralIndex]),
                    ...referralData
                  };
                } else {
                  // 如果不存在，添加新记录
                  updatedReferrals = [...existingReferrals, referralData];
                }
                
                // 从 referrals 数组计算 referralPoints 总和
                const calculatedReferralPoints = calculateReferralPointsFromArray(updatedReferrals);
                
                await updateDoc(doc(db, GLOBAL_COLLECTIONS.USERS, referrerId), {
                  'membership.points': referrerNewPoints,
                  'membership.referralPoints': calculatedReferralPoints,
                  'referral.referrals': updatedReferrals,
                  updatedAt: Timestamp.fromDate(new Date())
                });
                
                // 创建引荐人的首充奖励积分记录
                await createPointsRecord({
                  userId: referrerId,
                  userName: referrerData.displayName,
                  type: 'earn',
                  amount: referrerReward,
                  source: 'reload',
                  description: `引荐用户首次充值奖励 (${record.userName})`,
                  relatedId: recordId,
                  balance: referrerNewPoints,
                  createdBy: verifiedBy
                });
                
                // 记录到引荐人的 referrals 子集合
                try {
                  const referralsRef = collection(db, GLOBAL_COLLECTIONS.USERS, referrerId, 'referrals');
                  const referralDocRef = doc(referralsRef, record.userId);
                  
                  // 检查是否已存在引荐记录
                  const existingDoc = await getDoc(referralDocRef);
                  
                  if (existingDoc.exists()) {
                    // 更新现有记录
                    await updateDoc(referralDocRef, {
                      firstReloadReward: referrerReward,
                      firstReloadAt: Timestamp.fromDate(new Date()),
                      firstReloadRecordId: recordId,
                      updatedAt: Timestamp.fromDate(new Date())
                    });
                  } else {
                    // 创建新记录
                    const userDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.USERS, record.userId));
                    const referredUserData = userDoc.exists() ? userDoc.data() as User : null;
                    
                    await setDoc(referralDocRef, {
                      referredUserId: record.userId,
                      referredUserName: record.userName,
                      referredUserMemberId: referredUserData?.memberId || null,
                      firstReloadReward: referrerReward,
                      firstReloadAt: Timestamp.fromDate(new Date()),
                      firstReloadRecordId: recordId,
                      createdAt: Timestamp.fromDate(referredUserData?.referral?.referralDate || new Date()),
                      updatedAt: Timestamp.fromDate(new Date())
                    });
                  }
                } catch (referralError) {
                  // 记录失败不影响主流程
                }
              }
            }
          }
        }
      }
    } catch (firstReloadError) {
      // 首充奖励发放失败不应该影响充值验证流程
    }

    // 更新充值记录状态为已完成（积分已到账）
    await updateDoc(doc(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS, recordId), {
      status: 'completed',
      verifiedAt: Timestamp.fromDate(now),
      verifiedBy,
      verificationProof: verificationProof || null,
      adminNotes: adminNotes || null,
      pointsRecordId: pointsRecord?.id || null,
      updatedAt: Timestamp.fromDate(now)
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || '验证充值记录失败' };
  }
};

/**
 * 用户撤销充值记录（用户操作）- 直接删除记录
 */
export const cancelReloadRecord = async (
  recordId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const recordDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS, recordId));
    if (!recordDoc.exists()) {
      return { success: false, error: '充值记录不存在' };
    }

    const recordData = recordDoc.data();
    
    // 验证记录属于当前用户
    if (recordData.userId !== userId) {
      return { success: false, error: '无权操作此充值记录' };
    }

    // 只能撤销 pending 状态的记录
    if (recordData.status !== 'pending') {
      return { success: false, error: '该充值记录已处理，无法撤销' };
    }

    // 直接删除记录
    await deleteDoc(doc(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS, recordId));

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || '撤销充值记录失败' };
  }
};

/**
 * 拒绝充值记录（管理员操作）
 */
export const rejectReloadRecord = async (
  recordId: string,
  rejectedBy: string,
  adminNotes?: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const recordDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS, recordId));
    if (!recordDoc.exists()) {
      return { success: false, error: '充值记录不存在' };
    }

    const recordData = recordDoc.data();
    if (recordData.status !== 'pending') {
      return { success: false, error: '该充值记录已处理' };
    }

    const now = new Date();
    await updateDoc(doc(db, GLOBAL_COLLECTIONS.RELOAD_RECORDS, recordId), {
      status: 'rejected',
      verifiedBy: rejectedBy,
      adminNotes: adminNotes || null,
      updatedAt: Timestamp.fromDate(now)
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || '拒绝充值记录失败' };
  }
};

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

