// 会员年费配置与记录服务
import { 
  doc, 
  getDoc, 
  setDoc, 
  addDoc,
  getDocs,
  collection,
  query, 
  where, 
  orderBy,
  limit,
  startAfter,
  updateDoc,
  Timestamp,
  type QuerySnapshot,
  type DocumentData
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import type { MembershipFeeConfig, MembershipFeeRecord, User } from '../../types';
import { createPointsRecord } from './pointsRecords';

/**
 * 将 Firestore 文档转换为 MembershipFeeRecord
 */
const mapDocToMembershipFeeRecord = (doc: any): MembershipFeeRecord => {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    dueDate: data.dueDate?.toDate?.() || new Date(data.dueDate),
    deductedAt: data.deductedAt?.toDate?.() || data.deductedAt,
    previousDueDate: data.previousDueDate?.toDate?.() || data.previousDueDate,
    createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
    updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
  } as MembershipFeeRecord;
};

/**
 * 获取会员费配置
 */
export const getMembershipFeeConfig = async (): Promise<MembershipFeeConfig | null> => {
  try {
    const docRef = doc(db, 'config', 'membershipFee');
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        annualFees: (data.annualFees || []).map((fee: any) => ({
          ...fee,
          startDate: fee.startDate?.toDate?.() || new Date(fee.startDate),
          endDate: fee.endDate?.toDate?.() || fee.endDate
        })),
        updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
      } as MembershipFeeConfig;
    }
    
    return getDefaultMembershipFeeConfig();
  } catch (error) {
    return null;
  }
};

/**
 * 更新会员费配置
 */
export const updateMembershipFeeConfig = async (
  config: Omit<MembershipFeeConfig, 'id' | 'updatedAt'>,
  userId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const docRef = doc(db, 'config', 'membershipFee');
    
    await setDoc(docRef, {
      ...config,
      annualFees: config.annualFees.map(fee => ({
        ...fee,
        startDate: Timestamp.fromDate(fee.startDate),
        endDate: fee.endDate ? Timestamp.fromDate(fee.endDate) : null
      })),
      updatedAt: Timestamp.fromDate(new Date()),
      updatedBy: userId
    }, { merge: true });
    
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || '更新失败' };
  }
};

/**
 * 获取默认会员费配置
 */
export const getDefaultMembershipFeeConfig = (): MembershipFeeConfig => {
  return {
    id: 'default',
    annualFees: [
      {
        startDate: new Date('2025-01-01'),
        amount: 150, // 默认年费150积分
        rate: 25     // 默认每小时25积分
      }
    ],
    updatedAt: new Date(),
    updatedBy: 'system'
  };
};

/**
 * 根据日期获取当前生效的年费金额
 */
export const getCurrentAnnualFeeAmount = async (date?: Date): Promise<number> => {
  const config = await getMembershipFeeConfig();
  if (!config || !config.annualFees || config.annualFees.length === 0) {
    return 1000; // 默认值
  }

  const targetDate = date || new Date();
  
  // 找到第一个生效的配置（按startDate排序）
  const sortedFees = [...config.annualFees].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime()
  );

  for (const fee of sortedFees.reverse()) {
    if (targetDate >= fee.startDate) {
      if (!fee.endDate || targetDate <= fee.endDate) {
        return fee.amount;
      }
    }
  }

  // 如果没有匹配的，返回第一个（默认）
  return sortedFees[0]?.amount || 1000;
};

/**
 * 根据日期获取当前生效的每小时扣除积分
 */
export const getCurrentHourlyRate = async (date?: Date): Promise<number> => {
  const config = await getMembershipFeeConfig();
  if (!config || !config.annualFees || config.annualFees.length === 0) {
    return 25; // 默认值
  }

  const targetDate = date || new Date();
  
  // 找到第一个生效的配置（按startDate排序）
  const sortedFees = [...config.annualFees].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime()
  );

  for (const fee of sortedFees.reverse()) {
    if (targetDate >= fee.startDate) {
      if (!fee.endDate || targetDate <= fee.endDate) {
        return fee.rate;
      }
    }
  }

  // 如果没有匹配的，返回第一个（默认）
  return sortedFees[0]?.rate || 10;
};

/**
 * 创建会员年费记录
 */
export const createMembershipFeeRecord = async (
  userId: string,
  dueDate: Date,
  renewalType: 'initial' | 'renewal' = 'initial',
  previousDueDate?: Date,
  userName?: string,
  storeId?: string
): Promise<{ success: boolean; recordId?: string; error?: string }> => {
  try {
    const amount = await getCurrentAnnualFeeAmount(dueDate);

    const userDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.USERS, userId));
    if (!userDoc.exists()) {
      return { success: false, error: '用户不存在' };
    }

    const userData = userDoc.data() as User;
    const recordData: Omit<MembershipFeeRecord, 'id'> = {
      userId,
      userName: userName || userData.displayName,
      amount,
      dueDate,
      renewalType,
      previousDueDate,
      status: 'pending',
      storeId,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const docRef = await addDoc(collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS), {
      ...recordData,
      dueDate: Timestamp.fromDate(dueDate),
      previousDueDate: previousDueDate ? Timestamp.fromDate(previousDueDate) : null,
      createdAt: Timestamp.fromDate(recordData.createdAt),
      updatedAt: Timestamp.fromDate(recordData.updatedAt)
    });

    return { success: true, recordId: docRef.id };
  } catch (error: any) {
    return { success: false, error: error.message || '创建年费记录失败' };
  }
};

/**
 * 获取待扣费的年费记录（查询所有到期的pending记录）
 */
export const getPendingMembershipFeeRecords = async (targetDate?: Date): Promise<MembershipFeeRecord[]> => {
  try {
    const date = targetDate || new Date();
    const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    endOfDay.setHours(23, 59, 59, 999); // 当天的最后一刻


    // 查询所有status为pending且dueDate <= endOfDay的记录
    const q = query(
      collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
      where('status', '==', 'pending'),
      where('dueDate', '<=', Timestamp.fromDate(endOfDay)),
      orderBy('dueDate', 'asc')
    );

    const snapshot = await getDocs(q);
    const records = snapshot.docs.map(mapDocToMembershipFeeRecord);

    // 查询所有pending记录用于调试（不限制日期）
    try {
      const allPendingQuery = query(
        collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
        where('status', '==', 'pending')
      );
      const allPendingSnapshot = await getDocs(allPendingQuery);
      const allPendingRecords = allPendingSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          dueDate: data.dueDate?.toDate?.() || new Date(data.dueDate),
          amount: data.amount,
          userId: data.userId
        };
      });

      
      // 如果有pending记录但查询结果为0，输出警告
      if (allPendingRecords.length > 0 && records.length === 0) {
        const notDueRecords = allPendingRecords.filter(r => r.dueDate > endOfDay);
        if (notDueRecords.length > 0) {
          notDueRecords.forEach(r => {
            const daysUntilDue = Math.ceil((r.dueDate.getTime() - endOfDay.getTime()) / (1000 * 60 * 60 * 24));
            console.warn(
              `[getPendingMembershipFeeRecords] 有pending记录但未到期: 用户 ${r.userId}, ` +
              `应扣费日期 ${r.dueDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}, ` +
              `距离到期还有 ${daysUntilDue} 天`
            );
          });
          console.warn('[getPendingMembershipFeeRecords] 未到期记录详情:', {
            count: notDueRecords.length,
            endOfDay: endOfDay.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            records: notDueRecords.map(r => ({
              id: r.id,
              userId: r.userId,
              dueDate: r.dueDate.toISOString(),
              dueDateLocal: r.dueDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
              amount: r.amount,
              daysUntilDue: Math.ceil((r.dueDate.getTime() - endOfDay.getTime()) / (1000 * 60 * 60 * 24))
            }))
          });
        }
      }
    } catch (debugError) {
      // 调试查询失败不影响主流程
    }

    return records;
  } catch (error: any) {
    // 如果是索引错误，尝试不使用orderBy
    if (error.code === 'failed-precondition' || error.message?.includes('index')) {
      try {
        const date = targetDate || new Date();
        const endOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        endOfDay.setHours(23, 59, 59, 999);
        
        const q = query(
          collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
          where('status', '==', 'pending'),
          where('dueDate', '<=', Timestamp.fromDate(endOfDay))
        );
        
        const snapshot = await getDocs(q);
        const records = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            dueDate: data.dueDate?.toDate?.() || new Date(data.dueDate),
            deductedAt: data.deductedAt?.toDate?.() || data.deductedAt,
            previousDueDate: data.previousDueDate?.toDate?.() || data.previousDueDate,
            createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
            updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
          } as MembershipFeeRecord;
        });
        
        // 手动排序
        records.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
        return records;
      } catch (retryError) {
        return [];
      }
    }
    return [];
  }
};

/**
 * 扣除年费
 */
export const deductMembershipFee = async (
  recordId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const recordDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS, recordId));
    if (!recordDoc.exists()) {
      return { success: false, error: '年费记录不存在' };
    }

    const recordData = recordDoc.data();
    const record: MembershipFeeRecord = {
      id: recordDoc.id,
      userId: recordData.userId,
      userName: recordData.userName || '',
      amount: recordData.amount || 0,
      status: recordData.status || 'pending',
      renewalType: recordData.renewalType || 'initial',
      dueDate: recordData.dueDate?.toDate?.() || new Date(recordData.dueDate),
      deductedAt: recordData.deductedAt?.toDate?.() || recordData.deductedAt,
      previousDueDate: recordData.previousDueDate?.toDate?.() || recordData.previousDueDate,
      pointsRecordId: recordData.pointsRecordId || null,
      createdAt: recordData.createdAt?.toDate?.() || new Date(recordData.createdAt),
      updatedAt: recordData.updatedAt?.toDate?.() || new Date(recordData.updatedAt)
    };

    if (record.status !== 'pending') {
      return { success: false, error: '该年费记录已处理' };
    }

    // 获取用户信息
    const userDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.USERS, record.userId));
    if (!userDoc.exists()) {
      return { success: false, error: '用户不存在' };
    }

    const userData = userDoc.data() as User;
    const currentPoints = userData.membership?.points || 0;
    const newPoints = currentPoints - record.amount;

    const now = new Date();

    // 检查积分是否足够
    if (currentPoints >= record.amount) {
      // 积分足够，自动扣除并激活会员

      // 更新用户积分
      await updateDoc(doc(db, GLOBAL_COLLECTIONS.USERS, record.userId), {
        'membership.points': newPoints,
        status: 'active', // 激活 Annual Pass
        role: userData.role === 'guest' ? 'member' : userData.role,
        updatedAt: Timestamp.fromDate(now)
      });

      // 创建积分记录（在积分记录标签页显示）
      const pointsRecord = await createPointsRecord({
        userId: record.userId,
        userName: record.userName,
        type: 'spend',
        amount: record.amount,
        source: 'membership_fee',
        description: `会员年费 (${record.renewalType === 'initial' ? '首次开通' : '续费'})`,
        relatedId: recordId,
        balance: newPoints
      });

      // 更新年费记录状态为已支付
      await updateDoc(doc(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS, recordId), {
        status: 'paid',
        deductedAt: Timestamp.fromDate(now),
        pointsRecordId: pointsRecord?.id || null,
        updatedAt: Timestamp.fromDate(now)
      });

      // 如果是首次开通会员，仅记录到引荐人的 referrals 子集合（不写入 users 文档）
      if (record.renewalType === 'initial') {
        const referrerId = userData.referral?.referredByUserId;
        if (referrerId) {
          try {
            // 记录到 referrals 子集合
            const referralsRef = collection(db, GLOBAL_COLLECTIONS.USERS, referrerId, 'referrals');
            const referralDocRef = doc(referralsRef, record.userId);
            
            // 检查是否已存在引荐记录
            const existingDoc = await getDoc(referralDocRef);
            
            if (existingDoc.exists()) {
              // 更新现有记录
              await updateDoc(referralDocRef, {
                membershipActivatedAt: Timestamp.fromDate(now),
                updatedAt: Timestamp.fromDate(now)
              });
            } else {
              // 创建新记录
              await setDoc(referralDocRef, {
                referredUserId: record.userId,
                referredUserName: record.userName,
                referredUserMemberId: userData.memberId || null,
                membershipActivatedAt: Timestamp.fromDate(now),
                createdAt: Timestamp.fromDate(userData.referral?.referralDate || now),
                updatedAt: Timestamp.fromDate(now)
              });
            }
          } catch (referralError) {
            // 记录失败不影响主流程
          }
        }
      }

      // 如果是续费，设置首次驻店免扣费到期时间（续费后30天内）
      if (record.renewalType === 'renewal') {
        const waiverExpiresAt = new Date(now);
        waiverExpiresAt.setDate(waiverExpiresAt.getDate() + 30);
        await updateDoc(doc(db, GLOBAL_COLLECTIONS.USERS, record.userId), {
          'membership.nextFirstVisitWaiverExpiresAt': Timestamp.fromDate(waiverExpiresAt),
          updatedAt: Timestamp.fromDate(now)
        });
      }

      // 新期限从实际付款日开始，避免延迟续费导致期限缩短。
      const nextDueDate = new Date(now);
      nextDueDate.setFullYear(nextDueDate.getFullYear() + 1);
      await createMembershipFeeRecord(
        record.userId,
        nextDueDate,
        'renewal',
        record.dueDate,
        record.userName,
        recordData.storeId
      );

    } else {
      // 积分不足，不扣除，保持pending状态，设置用户为不活跃

      // 更新用户状态为不活跃（但不扣除积分，保持pending状态）
      await updateDoc(doc(db, GLOBAL_COLLECTIONS.USERS, record.userId), {
        status: 'inactive',
        updatedAt: Timestamp.fromDate(now)
      });

      // 年费记录保持pending状态，等待用户充值后再次尝试
      // 不创建积分记录，因为实际上没有扣除积分
      
      return { 
        success: false, 
        error: `积分不足，需要 ${record.amount} 积分，当前只有 ${currentPoints} 积分，缺少 ${record.amount - currentPoints} 积分` 
      };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || '扣除年费失败' };
  }
};

/**
 * 获取用户的所有年费记录
 */
export const getUserMembershipFeeRecords = async (
  userId: string,
  limitCount: number = 20
): Promise<MembershipFeeRecord[]> => {
  try {
    
    const q = query(
      collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
      where('userId', '==', userId),
      orderBy('dueDate', 'desc'),
      limit(limitCount)
    );

    const snapshot = await getDocs(q);
    const records = snapshot.docs.map(mapDocToMembershipFeeRecord);
    
    return records;
  } catch (error: any) {
    // 如果是因为缺少索引而失败，尝试不使用orderBy重新查询
    try {
      const q = query(
        collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
        where('userId', '==', userId),
        limit(limitCount)
      );

      const snapshot = await getDocs(q);
      const records = snapshot.docs.map(mapDocToMembershipFeeRecord);
      
      // 手动排序
      const sortedRecords = records.sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime());
      
      return sortedRecords;
    } catch (retryError) {
      return [];
    }
  }
};

/**
 * 获取所有年费记录（管理员查看）
 */
export const getAllMembershipFeeRecords = async (
  statusFilter?: 'pending' | 'paid' | 'failed' | 'cancelled',
  limitCount?: number
): Promise<MembershipFeeRecord[]> => {
  try {
    const allRecords: MembershipFeeRecord[] = [];
    const batchSize = 1000; // 每次查询1000条
    
    // 如果指定了 limit，直接查询
    if (limitCount !== undefined && limitCount > 0) {
    let q;
    if (statusFilter) {
      q = query(
        collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
        where('status', '==', statusFilter),
        orderBy('dueDate', 'desc'),
        limit(limitCount)
      );
    } else {
      q = query(
        collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
        orderBy('dueDate', 'desc'),
        limit(limitCount)
      );
    }

    const snapshot = await getDocs(q);
      return snapshot.docs.map(mapDocToMembershipFeeRecord);
    }
    
    // 如果没有限制，使用分页查询获取所有记录
    let lastDoc = null;
    let hasMore = true;
    
    while (hasMore) {
      let q;
      if (statusFilter) {
        if (lastDoc) {
          q = query(
            collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
            where('status', '==', statusFilter),
            orderBy('dueDate', 'desc'),
            startAfter(lastDoc),
            limit(batchSize)
          );
        } else {
          q = query(
            collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
            where('status', '==', statusFilter),
            orderBy('dueDate', 'desc'),
            limit(batchSize)
          );
        }
      } else {
        if (lastDoc) {
          q = query(
            collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
            orderBy('dueDate', 'desc'),
            startAfter(lastDoc),
            limit(batchSize)
          );
        } else {
          q = query(
            collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
            orderBy('dueDate', 'desc'),
            limit(batchSize)
          );
        }
      }

      const snapshot: QuerySnapshot<DocumentData> = await getDocs(q);
      const batch = snapshot.docs.map(mapDocToMembershipFeeRecord);
    
      allRecords.push(...batch);
      
      if (snapshot.docs.length < batchSize) {
        hasMore = false;
      } else {
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
      }
    }
    
    return allRecords;
  } catch (error: any) {
    try {
      const allRecords: MembershipFeeRecord[] = [];
      const batchSize = 1000;
      
      if (limitCount !== undefined && limitCount > 0) {
      let q;
      if (statusFilter) {
        q = query(
          collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
          where('status', '==', statusFilter),
          limit(limitCount)
        );
      } else {
        q = query(
          collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
          limit(limitCount)
        );
      }
      const snapshot = await getDocs(q);
      const records = snapshot.docs.map(mapDocToMembershipFeeRecord);
      return records.sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime());
      }
      
      // 分页获取所有记录
      let lastDoc = null;
      let hasMore = true;
      
      while (hasMore) {
        let q;
        if (statusFilter) {
          if (lastDoc) {
            q = query(
              collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
              where('status', '==', statusFilter),
              startAfter(lastDoc),
              limit(batchSize)
            );
          } else {
            q = query(
              collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
              where('status', '==', statusFilter),
              limit(batchSize)
            );
          }
        } else {
          if (lastDoc) {
            q = query(
              collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
              startAfter(lastDoc),
              limit(batchSize)
            );
          } else {
            q = query(
              collection(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS),
              limit(batchSize)
            );
          }
        }
        
        const snapshot: QuerySnapshot<DocumentData> = await getDocs(q);
        const batch = snapshot.docs.map(mapDocToMembershipFeeRecord);
        
        allRecords.push(...batch);
        
        if (snapshot.docs.length < batchSize) {
          hasMore = false;
        } else {
          lastDoc = snapshot.docs[snapshot.docs.length - 1];
        }
      }
      
      // 手动排序
      return allRecords.sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime());
    } catch (retryError) {
      return [];
    }
  }
};

export const getUserMembershipPeriod = async (userId: string): Promise<{ startDate: Date; endDate: Date } | null> => {
  try {
    // 获取用户所有年费记录
    const allRecords = await getUserMembershipFeeRecords(userId, 100);
    
    
    // 筛选出paid状态的记录
    const paidRecords = allRecords.filter(r => r.status === 'paid' && r.deductedAt);
    
    
    if (paidRecords.length === 0) {
      return null;
    }
    
    // 按deductedAt降序排序，取最新的
    const sortedPaidRecords = paidRecords.sort((a, b) => {
      const dateA = a.deductedAt?.getTime() || 0;
      const dateB = b.deductedAt?.getTime() || 0;
      return dateB - dateA;
    });
    
    const latestPaidRecord = sortedPaidRecords[0];
    if (!latestPaidRecord.deductedAt) {
      return null;
    }
    
    // 会员期限：从deductedAt开始，往后1年
    const startDate = new Date(latestPaidRecord.deductedAt);
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);
    
    
    return { startDate, endDate };
  } catch (error) {
    return null;
  }
};
