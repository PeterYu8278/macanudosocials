// 兑换配置与记录服务
import { 
  doc, 
  getDoc, 
  setDoc, 
  addDoc,
  updateDoc,
  getDocs,
  collection,
  query, 
  where, 
  orderBy, 
  limit,
  Timestamp,
  arrayUnion,
  runTransaction,
  FieldValue
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import type { RedemptionConfig, RedemptionRecord, RedemptionRecordItem, RedemptionRecordDocument, User } from '../../types';
import { getRedemptionCooldownSeconds } from '../../utils/redemptionCooldown';

/**
 * 获取兑换配置
 */
export const getRedemptionConfig = async (): Promise<RedemptionConfig | null> => {
  try {
    const docRef = doc(db, GLOBAL_COLLECTIONS.REDEMPTION_CONFIG, 'default');
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      return null;
    }
    
    const data = docSnap.data();
    const config = {
      id: docSnap.id,
      ...data,
      updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
    } as RedemptionConfig;
    return config;
  } catch (error) {
    return null;
  }
};

/**
 * 更新兑换配置
 */
export const updateRedemptionConfig = async (
  config: Partial<RedemptionConfig>,
  updatedBy: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const docRef = doc(db, GLOBAL_COLLECTIONS.REDEMPTION_CONFIG, 'default');
    const now = new Date();
    
    await setDoc(docRef, {
      ...config,
      updatedAt: Timestamp.fromDate(now),
      updatedBy
    }, { merge: true });
    
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || '更新兑换配置失败' };
  }
};

/**
 * 获取用户累计驻店时长（取消年度重计，计算全期所有完成驻店）
 */
export const getUserTotalVisitHoursInPeriod = async (userId: string): Promise<number> => {
  try {
    // 获取驻店记录
    const { getUserVisitSessions } = await import('./visitSessions');
    const sessions = await getUserVisitSessions(userId);

    // 计算所有已完成记录（排除 Day Pass）
    const totalHours = sessions
      .filter(s => s.status === 'completed' && s.durationHours && s.checkInType !== 'daypass')
      .reduce((sum, s) => sum + (s.durationHours || 0), 0);
    return totalHours;
  } catch (error) {
    console.error('[getUserTotalVisitHoursInPeriod] Error:', error);
    return 0;
  }
};

/**
 * 获取用户兑换限额
 * 基于累计驻店时长计算里程碑奖励：每50小时增加50支额度，无上限，取消年度重计
 */
export const getUserRedemptionLimits = async (userId: string): Promise<{
  dailyLimit: number;
  totalLimit: number;
  hourlyLimit?: number;
}> => {
  try {
    const config = await getRedemptionConfig();
    
    // 即使配置为空，也使用默认值并执行里程碑逻辑
    const baseDailyLimit = config?.dailyLimit || 3;
    const baseTotalLimit = config?.totalLimit || 25;
    const hourlyLimit = config?.hourlyLimit;

    // 获取累计驻店时长
    const totalVisitHours = await getUserTotalVisitHoursInPeriod(userId);
    
    // 每50小时增加限额（totalLimit +50，无上限；每日上限保持基础设定，取消小时数加成）
    const intervals = Math.floor(totalVisitHours / 50);
    const dailyLimitBonus = 0;
    const totalLimitBonus = intervals * 25;

    const finalLimits = {
      dailyLimit: baseDailyLimit + dailyLimitBonus,
      totalLimit: baseTotalLimit + totalLimitBonus,
      hourlyLimit: hourlyLimit
    };

    return finalLimits;
  } catch (error) {
    return { dailyLimit: 3, totalLimit: 25 };
  }
};

/**
 * 检查用户是否可以兑换
 */
export const canUserRedeem = async (
  userId: string,
  quantity: number,
  targetDate?: Date
): Promise<{ canRedeem: boolean; reason?: string }> => {
  try {
    // 检查会员状态
    const userDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.USERS, userId));
    if (!userDoc.exists()) {
      return { canRedeem: false, reason: '用户不存在' };
    }

    const userData = userDoc.data() as User;
    
    // 检查是否有 pending session 且已购买 Day Pass
    const { getPendingVisitSession } = await import('./visitSessions');
    const pendingSession = await getPendingVisitSession(userId);
    
    if (!pendingSession) {
      return { canRedeem: false, reason: '请先check-in才能兑换' };
    }
 
    const hasActiveDayPass = pendingSession?.dayPass?.isPurchased;
    if (userData.status !== 'active' && !hasActiveDayPass) {
      return { canRedeem: false, reason: '会员状态不活跃且未购买 Day Pass，无法兑换' };
    }
 
    // 检查是否在截止时间之前
    const config = await getRedemptionConfig();
    if (config) {
      const now = targetDate || new Date();
      const [cutoffHour, cutoffMinute] = config.cutoffTime.split(':').map(Number);
      const cutoffTime = new Date(now);
      cutoffTime.setHours(cutoffHour, cutoffMinute, 0, 0);
 
      if (now >= cutoffTime) {
        return { canRedeem: false, reason: `兑换截止时间为 ${config.cutoffTime}，请明日再试` };
      }
    }

    // 获取限额
    const limits = await getUserRedemptionLimits(userId);

    // 待处理申请也占用限额，避免多设备同时预支同一份额度。
    const dayKey = (targetDate || new Date()).toISOString().split('T')[0]; // YYYY-MM-DD
    const dailyRedemptions = await getDailyRedemptions(userId, dayKey);
    const dailyCount = dailyRedemptions.reduce((sum, r) => sum + r.quantity, 0);
    if (dailyCount + quantity > limits.dailyLimit) {
      return { canRedeem: false, reason: `今日兑换限额为 ${limits.dailyLimit}，已兑换 ${dailyCount}，剩余 ${limits.dailyLimit - dailyCount}` };
    }

    // 检查总限额（包含待处理申请）
    const totalRedemptions = await getTotalRedemptions(userId);
    const totalCount = totalRedemptions.reduce((sum, r) => sum + r.quantity, 0);
    if (totalCount + quantity > limits.totalLimit) {
      return { canRedeem: false, reason: `总兑换限额为 ${limits.totalLimit}，已兑换 ${totalCount}，剩余 ${limits.totalLimit - totalCount}` };
    }

    // 检查每小时限额（包含待处理申请）
    const now = targetDate || new Date();
    const hourKey = now.toISOString().split(':')[0]; // YYYY-MM-DDTHH
    const hourlyRedemptions = await getHourlyRedemptions(userId, hourKey);
    const hourlyCount = hourlyRedemptions.reduce((sum, r) => sum + r.quantity, 0);
    
    // 如果配置了hourlyLimit，使用配置值；否则默认每小时只能兑换1次
    const effectiveHourlyLimit = limits.hourlyLimit !== undefined ? limits.hourlyLimit : 1;
    
    if (hourlyCount + quantity > effectiveHourlyLimit) {
      return { canRedeem: false, reason: `每小时兑换限额为 ${effectiveHourlyLimit}，本小时已兑换 ${hourlyCount}` };
    }

    return { canRedeem: true };
  } catch (error: any) {
    return { canRedeem: false, reason: error.message || '检查失败' };
  }
};

/**
 * 创建待处理的兑换记录（用户发起，等待管理员选择雪茄）
 * 同一个 visitSessionId 的所有兑换记录存储在同一个文档中
 */
export const createPendingRedemptionRecord = async (
  userId: string,
  visitSessionId: string,
  quantity: number,
  targetDate?: Date
): Promise<{ success: boolean; recordId?: string; error?: string }> => {
  try {
    // 验证是否可以兑换
    const canRedeem = await canUserRedeem(userId, quantity, targetDate);
    if (!canRedeem.canRedeem) {
      return { success: false, error: canRedeem.reason || '无法兑换' };
    }

    const userDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.USERS, userId));
    if (!userDoc.exists()) {
      return { success: false, error: '用户不存在' };
    }

    const userData = userDoc.data() as User;
    const now = targetDate || new Date();
    
    // 获取限额
    const limits = await getUserRedemptionLimits(userId);
    const dayKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
    // 始终设置hourKey（即使没有配置hourlyLimit，也需要记录以便检查每小时限制）
    const hourKey = now.toISOString().split(':')[0]; // YYYY-MM-DDTHH

    // 获取当日兑换次数（只计算已完成的记录）
    const dailyRedemptions = await getDailyRedemptions(userId, dayKey);
    const completedRedemptions = dailyRedemptions.filter(r => r.status === 'completed');
    const redemptionIndex = completedRedemptions.length + 1;

    // 生成记录项的唯一ID
    const recordItemId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const recordItem: RedemptionRecordItem = {
      id: recordItemId,
      userId,
      userName: userData.displayName,
      cigarId: '',  // 待管理员选择
      cigarName: '待选择',  // 占位符
      quantity,
      status: 'pending',  // 待处理状态
      dayKey,
      hourKey,
      redemptionIndex,
      redeemedAt: now,
      redeemedBy: userId,  // 用户ID（用户发起）
      createdAt: now
    };

    // 使用事务确保原子性：将兑换记录添加到同一个 visitSessionId 的文档中
    await runTransaction(db, async (transaction) => {
      const docRef = doc(db, GLOBAL_COLLECTIONS.REDEMPTION_RECORDS, visitSessionId);
      const sessionRef = doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, visitSessionId);
      const docSnap = await transaction.get(docRef);
      const sessionSnap = await transaction.get(sessionRef);

      if (!sessionSnap.exists()) {
        throw new Error('驻店记录不存在');
      }

      const sessionData = sessionSnap.data();
      if (sessionData.userId !== userId || sessionData.status !== 'pending') {
        throw new Error('当前驻店记录无法兑换');
      }

      const existingRedemptions = docSnap.exists()
        ? ((docSnap.data().redemptions || []) as RedemptionRecordItem[])
        : [];
      const remainingCooldown = getRedemptionCooldownSeconds(existingRedemptions, now);

      if (remainingCooldown > 0) {
        const minutes = Math.ceil(remainingCooldown / 60);
        throw new Error(`兑换请求已提交，请在 ${minutes} 分钟后再试`);
      }

      const sessionDailyCount = existingRedemptions
        .filter(item => item.dayKey === dayKey)
        .reduce((sum, item) => sum + item.quantity, 0);
      if (sessionDailyCount + quantity > limits.dailyLimit) {
        throw new Error(`今日兑换限额为 ${limits.dailyLimit}`);
      }
      
      if (docSnap.exists()) {
        // 同时补齐旧版文档缺失的所有权字段。
        transaction.update(docRef, {
          visitSessionId,
          userId,
          userName: userData.displayName,
          redemptions: arrayUnion(recordItem),
          updatedAt: Timestamp.fromDate(now)
        });
      } else {
        // 文档不存在，创建新文档
        const newDoc: Omit<RedemptionRecordDocument, 'id'> = {
          visitSessionId,
          userId,
          userName: userData.displayName,
          redemptions: [recordItem],
          createdAt: now,
          updatedAt: now
        };
        transaction.set(docRef, {
          ...newDoc,
          createdAt: Timestamp.fromDate(now),
          updatedAt: Timestamp.fromDate(now)
        });
      }

      transaction.update(sessionRef, {
        redemptions: arrayUnion({
          recordId: recordItemId,
          cigarId: '',
          cigarName: '待选择',
          quantity,
          redeemedBy: userId,
          redeemedAt: Timestamp.fromDate(now)
        }),
        updatedAt: Timestamp.fromDate(now)
      });
    });

    return { success: true, recordId: recordItemId };
  } catch (error: any) {
    return { success: false, error: error.message || '创建兑换记录失败' };
  }
};

/**
 * 创建兑换记录（管理员创建或确认）
 * 管理员手动添加时不受每日限额、总限额和每小时限额限制
 * 同一个 visitSessionId 的所有兑换记录存储在同一个文档中
 */
export const createRedemptionRecord = async (
  userId: string,
  visitSessionId: string,
  cigarId: string,
  cigarName: string,
  quantity: number,
  redeemedBy: string,
  targetDate?: Date
): Promise<{ success: boolean; recordId?: string; error?: string }> => {
  try {
    // 检查用户是否存在
    const userDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.USERS, userId));
    if (!userDoc.exists()) {
      return { success: false, error: '用户不存在' };
    }

    const userData = userDoc.data() as User;
    
    // 检查会员状态（管理员添加时也需要检查）
    if (userData.status !== 'active') {
      return { success: false, error: '会员状态不活跃，无法兑换' };
    }

    // 检查是否有pending的visit session（管理员添加时也需要检查）
    const { getPendingVisitSession } = await import('./visitSessions');
    const pendingSession = await getPendingVisitSession(userId);
    if (!pendingSession) {
      return { success: false, error: '请先check-in才能兑换' };
    }

    // 管理员手动添加时，跳过限额检查（每日限额、总限额、每小时限额）
    // 只保留基本的会员状态和visit session检查
    
    const now = targetDate || new Date();
    
    // 获取限额（用于计算 redemptionIndex）
    const limits = await getUserRedemptionLimits(userId);
    const dayKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
    // 始终设置hourKey（即使没有配置hourlyLimit，也需要记录以便检查每小时限制）
    const hourKey = now.toISOString().split(':')[0]; // YYYY-MM-DDTHH

    // 获取当日兑换次数（只计算已完成的记录）
    const dailyRedemptions = await getDailyRedemptions(userId, dayKey);
    const completedRedemptions = dailyRedemptions.filter(r => r.status === 'completed');
    const redemptionIndex = completedRedemptions.length + 1;

    // 生成记录项的唯一ID
    const recordItemId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const recordItem: RedemptionRecordItem = {
      id: recordItemId,
      userId,
      userName: userData.displayName,
      cigarId,
      cigarName,
      quantity,
      status: 'completed',  // 管理员创建的直接是已完成状态
      dayKey,
      hourKey,
      redemptionIndex,
      redeemedAt: now,
      redeemedBy,
      createdAt: now
    };

    // 使用事务确保原子性：将兑换记录添加到同一个 visitSessionId 的文档中
    await runTransaction(db, async (transaction) => {
      const docRef = doc(db, GLOBAL_COLLECTIONS.REDEMPTION_RECORDS, visitSessionId);
      const docSnap = await transaction.get(docRef);
      
      if (docSnap.exists()) {
        // 同时补齐旧版文档缺失的所有权字段。
        transaction.update(docRef, {
          visitSessionId,
          userId,
          userName: userData.displayName,
          redemptions: arrayUnion(recordItem),
          updatedAt: Timestamp.fromDate(now)
        });
      } else {
        // 文档不存在，创建新文档
        const newDoc: Omit<RedemptionRecordDocument, 'id'> = {
          visitSessionId,
          userId,
          userName: userData.displayName,
          redemptions: [recordItem],
          createdAt: now,
          updatedAt: now
        };
        transaction.set(docRef, {
          ...newDoc,
          createdAt: Timestamp.fromDate(now),
          updatedAt: Timestamp.fromDate(now)
        });
      }
    });

    // 添加到visit session的redemptions数组
    const { addRedemptionToSession } = await import('./visitSessions');
    await addRedemptionToSession(visitSessionId, {
      cigarId,
      cigarName,
      quantity,
      redeemedBy
    });

    return { success: true, recordId: recordItemId };
  } catch (error: any) {
    return { success: false, error: error.message || '创建兑换记录失败' };
  }
};

/**
 * 更新兑换记录（管理员选择雪茄并确认）
 * 需要找到包含该 recordId 的文档，然后更新数组中的特定项
 */
export const updateRedemptionRecord = async (
  recordId: string,
  cigarId: string,
  cigarName: string,
  quantity: number,
  confirmedBy: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    // 需要查询所有文档来找到包含该 recordId 的文档
    // 由于无法直接查询数组中的字段，我们需要遍历所有文档
    const q = query(collection(db, GLOBAL_COLLECTIONS.REDEMPTION_RECORDS));
    const snapshot = await getDocs(q);
    
    let foundDoc: { docId: string; data: RedemptionRecordDocument } | null = null;
    let foundItemIndex: number = -1;
    
    // 查找包含该 recordId 的文档和项
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as RedemptionRecordDocument;
      const index = data.redemptions?.findIndex((item: RedemptionRecordItem) => item.id === recordId);
      if (index !== undefined && index >= 0) {
        foundDoc = { docId: docSnap.id, data };
        foundItemIndex = index;
        break;
      }
    }
    
    if (!foundDoc || foundItemIndex < 0) {
      return { success: false, error: '兑换记录不存在' };
    }
    
    const now = new Date();

    // 更新数组中的特定项
    const updatedRedemptions = [...foundDoc.data.redemptions];
    updatedRedemptions[foundItemIndex] = {
      ...updatedRedemptions[foundItemIndex],
      cigarId,
      cigarName,
      quantity,
      status: 'completed',
      redeemedBy: confirmedBy,
      updatedAt: now
    };

    // 更新文档
    const docRef = doc(db, GLOBAL_COLLECTIONS.REDEMPTION_RECORDS, foundDoc.docId);
    await updateDoc(docRef, {
      redemptions: updatedRedemptions,
      updatedAt: Timestamp.fromDate(now)
    });

    // 更新 visitSessions 文档中对应的记录（将 '待选择' 的记录更新为实际的雪茄信息）
    // 由于用户点击redeem时已经添加了记录，这里需要更新而不是添加
    try {
      const visitSessionRef = doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, foundDoc.data.visitSessionId);
      const visitSessionDoc = await getDoc(visitSessionRef);
      
      if (visitSessionDoc.exists()) {
        const visitSessionData = visitSessionDoc.data();
        const redemptions = visitSessionData.redemptions || [];
        
        // 找到对应的记录（通过 recordId 匹配，如果没有 recordId 则使用时间戳匹配）
        const recordItem = foundDoc.data.redemptions[foundItemIndex];
        const recordRedeemedAt = recordItem.redeemedAt?.getTime?.() || new Date(recordItem.redeemedAt).getTime();
        
        const updatedRedemptions = redemptions.map((r: any) => {
          // 优先使用 recordId 匹配
          if (r.recordId === recordId) {
            return {
              ...r,
              cigarId,
              cigarName,
              quantity,
              redeemedBy: confirmedBy
            };
          }
          // 如果没有 recordId，使用时间戳匹配（向后兼容）
          const rRedeemedAt = r.redeemedAt?.toDate?.()?.getTime() || new Date(r.redeemedAt).getTime();
          if (Math.abs(rRedeemedAt - recordRedeemedAt) < 1000 && (!r.cigarId || r.cigarId === '')) {
            return {
              ...r,
              recordId: recordId,  // 添加 recordId 以便后续更新
              cigarId,
              cigarName,
              quantity,
              redeemedBy: confirmedBy
            };
          }
          return r;
        });
        
        await updateDoc(visitSessionRef, {
          redemptions: updatedRedemptions,
          updatedAt: Timestamp.fromDate(now)
        });
      }
    } catch (error: any) {
      console.warn('[updateRedemptionRecord] 更新 visitSessions 记录失败:', error);
      // 如果更新失败，尝试添加新记录（向后兼容）
      const { addRedemptionToSession } = await import('./visitSessions');
      await addRedemptionToSession(foundDoc.data.visitSessionId, {
        cigarId,
        cigarName,
        quantity,
        redeemedBy: confirmedBy
      });
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || '更新兑换记录失败' };
  }
};

/**
 * 获取指定驻店记录的兑换记录（包括待处理和已完成的）
 * 文档ID = visitSessionId，直接读取文档并返回 redemptions 数组
 */
export const getRedemptionRecordsBySession = async (
  visitSessionId: string
): Promise<RedemptionRecord[]> => {
  try {
    const docRef = doc(db, GLOBAL_COLLECTIONS.REDEMPTION_RECORDS, visitSessionId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      return [];
    }

    const data = docSnap.data() as RedemptionRecordDocument;
    const redemptions = data.redemptions || [];
    
    // 转换日期字段并添加 visitSessionId 以保持兼容性
    return redemptions.map(item => {
      const redeemedAt = (item.redeemedAt as any)?.toDate?.() || (item.redeemedAt instanceof Date ? item.redeemedAt : new Date(item.redeemedAt as any))
      const createdAt = (item.createdAt as any)?.toDate?.() || (item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt as any))
      const updatedAt = (item.updatedAt as any)?.toDate?.() || (item.updatedAt instanceof Date ? item.updatedAt : item.updatedAt)
      
      return {
      ...item,
      visitSessionId: visitSessionId,
        redeemedAt,
        createdAt,
        updatedAt
      } as RedemptionRecord
    })
  } catch (error: any) {
    return [];
  }
};

/**
 * 获取用户当日的兑换记录（基于当前会员期限）
 * 查询所有包含该userId的文档，然后过滤redemptions数组中dayKey匹配的记录
 */
export const getDailyRedemptions = async (
  userId: string,
  dayKey: string
): Promise<RedemptionRecord[]> => {
  try {
    // 获取会员期限
    const { getUserMembershipPeriod } = await import('./membershipFee');
    const period = await getUserMembershipPeriod(userId);
    
    // 查询所有包含该userId的文档（每用户每日最多100条驻店记录）
    const q = query(
      collection(db, GLOBAL_COLLECTIONS.REDEMPTION_RECORDS),
      where('userId', '==', userId),
      limit(100)
    );

    const snapshot = await getDocs(q);
    let allRecords: RedemptionRecord[] = [];

    // 遍历所有文档，提取redemptions数组中dayKey匹配的记录
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data() as RedemptionRecordDocument;
      const redemptions = data.redemptions || [];
      
      redemptions.forEach(item => {
        if (item.dayKey === dayKey) {
          const redeemedAt = (item.redeemedAt as any)?.toDate?.() || (item.redeemedAt instanceof Date ? item.redeemedAt : new Date(item.redeemedAt as any))
          const createdAt = (item.createdAt as any)?.toDate?.() || (item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt as any))
          const updatedAt = (item.updatedAt as any)?.toDate?.() || (item.updatedAt instanceof Date ? item.updatedAt : item.updatedAt)
          
          allRecords.push({
            ...item,
            visitSessionId: data.visitSessionId,
            redeemedAt,
            createdAt,
            updatedAt
          } as RedemptionRecord);
        }
      });
    });
    
    // 如果存在会员期限，过滤出在会员期限内的记录
    if (period) {
      allRecords = allRecords.filter(record => {
        return record.redeemedAt >= period.startDate && record.redeemedAt < period.endDate;
      });
    }
    
    // 按时间排序
    allRecords.sort((a, b) => a.redeemedAt.getTime() - b.redeemedAt.getTime());
    
    return allRecords;
  } catch (error: any) {
      return [];
  }
};

/**
 * 获取用户每小时的兑换记录
 * 查询所有包含该userId的文档，然后过滤redemptions数组中hourKey匹配的记录
 */
export const getHourlyRedemptions = async (
  userId: string,
  hourKey: string
): Promise<RedemptionRecord[]> => {
  try {
    // 查询所有包含该userId的文档（每用户每小时最多50条驻店记录）
    const q = query(
      collection(db, GLOBAL_COLLECTIONS.REDEMPTION_RECORDS),
      where('userId', '==', userId),
      limit(50)
    );

    const snapshot = await getDocs(q);
    const allRecords: RedemptionRecord[] = [];

    // 遍历所有文档，提取redemptions数组中hourKey匹配的记录
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data() as RedemptionRecordDocument;
      const redemptions = data.redemptions || [];
      
      redemptions.forEach(item => {
        if (item.hourKey === hourKey) {
          const redeemedAt = (item.redeemedAt as any)?.toDate?.() || (item.redeemedAt instanceof Date ? item.redeemedAt : new Date(item.redeemedAt as any))
          const createdAt = (item.createdAt as any)?.toDate?.() || (item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt as any))
          const updatedAt = (item.updatedAt as any)?.toDate?.() || (item.updatedAt instanceof Date ? item.updatedAt : item.updatedAt)
          
          allRecords.push({
            ...item,
            visitSessionId: data.visitSessionId,
            redeemedAt,
            createdAt,
            updatedAt
          } as RedemptionRecord);
        }
      });
    });
    
    // 按时间排序
    allRecords.sort((a, b) => a.redeemedAt.getTime() - b.redeemedAt.getTime());
    
    return allRecords;
  } catch (error: any) {
      return [];
  }
};

/**
 * 获取用户的总兑换记录（基于当前会员期限）
 */
export const getTotalRedemptions = async (userId: string): Promise<RedemptionRecord[]> => {
  try {
    // 注意：REDEMPTION_RECORDS 集合中的文档是按 visitSessionId 分组的
    // 文档本身没有 redeemedAt 字段，该字段在 redemptions 数组项中
    // limit(500) 防止无界读取；超出500条时仍以计数器字段作为精确计数的长远方案
    const q = query(
      collection(db, GLOBAL_COLLECTIONS.REDEMPTION_RECORDS),
      where('userId', '==', userId),
      limit(500)
    );

    const snapshot = await getDocs(q);
    let allRecords: RedemptionRecord[] = [];
    
    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data() as RedemptionRecordDocument;
      const redemptions = data.redemptions || [];
      
      redemptions.forEach(item => {
        // 跳过 Day Pass 兑换记录，不计入累计总数
        if (item.isDayPass) return;

        // 转换日期
        const redeemedAt = (item.redeemedAt as any)?.toDate?.() || (item.redeemedAt instanceof Date ? item.redeemedAt : new Date(item.redeemedAt as any));
        const createdAt = (item.createdAt as any)?.toDate?.() || (item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt as any));
        const updatedAt = (item.updatedAt as any)?.toDate?.() || (item.updatedAt instanceof Date ? item.updatedAt : item.updatedAt);
        
        allRecords.push({
          ...item,
          visitSessionId: data.visitSessionId,
          redeemedAt,
          createdAt,
          updatedAt,
          status: item.status || 'completed'
        } as RedemptionRecord);
      });
    });
    
    // 按时间排序
    allRecords.sort((a, b) => a.redeemedAt.getTime() - b.redeemedAt.getTime());
    
    return allRecords;
  } catch (error) {
    console.error('[getTotalRedemptions] Error:', error);
    return [];
  }
};
