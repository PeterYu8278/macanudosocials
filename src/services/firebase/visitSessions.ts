// 驻店记录服务
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc,
  updateDoc,
  query, 
  where, 
  orderBy, 
  limit,
  Timestamp,
  arrayUnion,
  runTransaction,
  type Query,
  onSnapshot,
  type Unsubscribe
} from 'firebase/firestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import type { VisitSession, User, Order, OutboundOrder } from '../../types';
import { COLLECTIONS, createOutboundOrder, getCigarById } from './firestore';
import { aggregateCompletedRedemptions, areRedemptionsReadyForSettlement } from '../../utils/redemptionOrder';
import { getRedemptionOrderMonth, resolveRedemptionOrderId } from '../../utils/redemptionOrderId';
import { calculateRebateReward } from '../../utils/purchaseRewards';
import { calculateCheckoutAffordability, MINIMUM_RELOAD_AMOUNT_RM } from '../../utils/visitCheckout';

/**
 * 处理 visit session 数据，转换日期字段和 redemptions
 */
const processVisitSessionData = (data: any, docId: string): VisitSession => {
  // 处理 redemptions 数组中的日期字段
  const redemptions = (data.redemptions || []).map((redemption: any) => ({
    ...redemption,
    redeemedAt: redemption.redeemedAt?.toDate?.() || new Date(redemption.redeemedAt) || new Date()
  }));
  
  return {
    id: docId,
    ...data,
    checkInAt: data.checkInAt?.toDate?.() || new Date(data.checkInAt),
    checkOutAt: data.checkOutAt?.toDate?.() || data.checkOutAt,
    calculatedAt: data.calculatedAt?.toDate?.() || data.calculatedAt,
    nextDeductionAt: data.nextDeductionAt?.toDate?.() || data.nextDeductionAt,
    checkoutPending: data.checkoutPending ? {
      ...data.checkoutPending,
      requestedAt: data.checkoutPending.requestedAt?.toDate?.() || new Date(data.checkoutPending.requestedAt)
    } : undefined,
    createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
    updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
    redemptions: redemptions.length > 0 ? redemptions : undefined,
    dayPass: data.dayPass ? {
      ...data.dayPass,
      purchasedAt: data.dayPass.purchasedAt?.toDate?.() || new Date(data.dayPass.purchasedAt)
    } : undefined
  } as VisitSession;
};

/**
 * 按完整分钟计算驻店时长并转换为小时。
 * 不足一分钟的部分不计入，返回值仍以小时为单位供费率计算使用。
 */
export const calculateVisitDuration = (minutes: number): number => {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;

  const completedMinutes = Math.floor(minutes);
  return completedMinutes / 60;
};

/**
 * 创建驻店记录（Check-in）
 */
export const createVisitSession = async (
  userId: string,
  checkInBy: string,
  storeId: string,
  storeName?: string,
  userName?: string
): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
  try {
    
    // 检查用户是否有未完成的session
    let pendingSession: VisitSession | null = null;
    try {
      pendingSession = await getPendingVisitSession(userId);
    } catch (error: any) {
      console.error('[createVisitSession] 检查pending session失败:', error);
      // 如果是索引错误，给出明确提示
      if (error.code === 'failed-precondition' || error.message?.includes('index')) {
        return { 
          success: false, 
          error: 'Firestore索引未创建，请在Firebase控制台创建复合索引：visitSessions (userId, status, checkInAt)' 
        };
      }
      // 其他错误继续处理
    }
    
    if (pendingSession) {
      return { success: false, error: '签到失败：用户已有未完成的驻店记录，请先check-out' };
    }

    // 获取用户信息，检查会员状态
    const userDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.USERS, userId));
    if (!userDoc.exists()) {
      console.error('[createVisitSession] 用户不存在:', userId);
      return { success: false, error: '签到失败：用户不存在' };
    }

    const userData = userDoc.data() as User;
    
    if (userData.status !== 'active') {
      console.error('[createVisitSession] 非活跃会员尝试签到:', userData.status);
      return { 
        success: false, 
        error: '签到失败：需先开通会员或购买 Day Pass。' 
      };
    }

    // 检查是否为续费后首次驻店
    const isFirstVisitAfterRenewal = userData.membership?.nextFirstVisitWaiverExpiresAt 
      && new Date() <= new Date(userData.membership.nextFirstVisitWaiverExpiresAt);

    const now = new Date();

    // Annual Membership (非首次免单、非 Day Pass) 启用实时阶梯扣费
    const useRealtimeDeductions = !isFirstVisitAfterRenewal;

    // 预先获取 hourlyRate，供初始扣费使用
    let hourlyRate = 10;
    if (useRealtimeDeductions) {
      try {
        const { getCurrentHourlyRate } = await import('./membershipFee');
        hourlyRate = await getCurrentHourlyRate(now);
      } catch (e) {
        console.error('[createVisitSession] 获取积分费率失败，使用默认值', e);
      }
    }

    const initialDeduction = useRealtimeDeductions ? hourlyRate : 0; // 1 小时，保留配置费率精度
    const initialAffordability = calculateCheckoutAffordability(
      userData.membership?.points || 0,
      initialDeduction
    );
    if (!initialAffordability.canCheckout) {
      return {
        success: false,
        error: `积分不足，无法 Check-in。当前 ${userData.membership?.points || 0} 分，首小时需 ${initialDeduction} 分，还需充值 ${initialAffordability.shortfall} 分（最低充值 RM ${MINIMUM_RELOAD_AMOUNT_RM}）`
      };
    }

    const nextDeductionAt = useRealtimeDeductions
      ? new Date(now.getTime() + 60 * 60 * 1000) // checkInAt + 60 min
      : undefined;

    const sessionData: Omit<VisitSession, 'id'> = {
      userId,
      userName: userName || userData.displayName,
      storeId,
      storeName: storeName || '',
      checkInAt: now,
      checkInBy,
      status: 'pending',
      checkInType: 'membership',
      isFirstVisitAfterRenewal: !!isFirstVisitAfterRenewal,
      ...(useRealtimeDeductions && {
        realtimeDeductionsEnabled: true,
        realtimePointsDeducted: initialDeduction,
        nextDeductionAt,
        deductionCount: 1,
      }),
      createdAt: now,
      updatedAt: now
    };

    const docRef = doc(collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS));
    const userRef = doc(db, GLOBAL_COLLECTIONS.USERS, userId);
    const initialPointsRecordRef = initialDeduction > 0
      ? doc(collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS))
      : null;
    await runTransaction(db, async transaction => {
      const latestUserDoc = await transaction.get(userRef);
      if (!latestUserDoc.exists()) throw new Error('签到失败：用户不存在');

      const latestUser = latestUserDoc.data() as User;
      const latestPoints = latestUser.membership?.points || 0;
      const latestAffordability = calculateCheckoutAffordability(latestPoints, initialDeduction);
      if (!latestAffordability.canCheckout) {
        throw new Error(
          `积分不足，无法 Check-in。当前 ${latestPoints} 分，首小时需 ${initialDeduction} 分，还需充值 ${latestAffordability.shortfall} 分（最低充值 RM ${MINIMUM_RELOAD_AMOUNT_RM}）`
        );
      }

      transaction.set(docRef, {
        ...sessionData,
        checkInAt: Timestamp.fromDate(now),
        ...(nextDeductionAt && { nextDeductionAt: Timestamp.fromDate(nextDeductionAt) }),
        createdAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now)
      });
      transaction.update(userRef, {
        'membership.points': latestAffordability.balanceAfterCharge,
        ...(initialDeduction > 0 ? {
          'membership.totalVisitHours': (latestUser.membership?.totalVisitHours || 0) + 1
        } : {}),
        'membership.currentVisitSessionId': docRef.id,
        'membership.lastCheckInAt': Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now)
      });
      if (initialPointsRecordRef) {
        transaction.set(initialPointsRecordRef, {
          userId,
          userName: userName || latestUser.displayName,
          type: 'spend',
          amount: initialDeduction,
          source: 'visit',
          description: `驻店开始扣费 (1小时，共${initialDeduction}积分)`,
          relatedId: docRef.id,
          balance: latestAffordability.balanceAfterCharge,
          createdAt: Timestamp.fromDate(now),
          createdBy: checkInBy
        });
      }
    });

    return { success: true, sessionId: docRef.id };
  } catch (error: any) {
    console.error('[createVisitSession] 创建失败:', error);
    return { success: false, error: error.message || '创建驻店记录失败' };
  }
};

/**
 * 处理实时阶梯扣费（Annual Membership）
 * 补扣所有到期但尚未执行的 0.5 小时扣费区间。
 * 应在 session 轮询时（客户端）和 checkout 前调用。
 */
export const processSessionRealtimeDeduction = async (
  sessionId: string,
  userId: string,
  asOf: Date = new Date()
): Promise<{
  deducted: number;
  count: number;
  insufficient?: {
    currentPoints: number;
    pointsDue: number;
    shortfall: number;
    hoursDue: number;
    deductionCountTarget: number;
  };
}> => {
  const now = asOf;
  const sessionRef = doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, sessionId);
  const userRef = doc(db, GLOBAL_COLLECTIONS.USERS, userId);
  const pointsRecordRef = doc(collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS));
  const sessionDoc = await getDoc(sessionRef);
  if (!sessionDoc.exists()) return { deducted: 0, count: 0 };

  const data = sessionDoc.data() as any;
  if (!data.realtimeDeductionsEnabled || data.status !== 'pending') return { deducted: 0, count: 0 };

  const nextDeductionAt: Date = data.nextDeductionAt?.toDate?.() ?? null;
  if (!nextDeductionAt || now < nextDeductionAt) return { deducted: 0, count: 0 };

  // 获取费率
  const checkInAt: Date = data.checkInAt?.toDate?.() || new Date(data.checkInAt);
  let hourlyRate = 10;
  try {
    const { getCurrentHourlyRate } = await import('./membershipFee');
    hourlyRate = await getCurrentHourlyRate(checkInAt);
  } catch (e) {
    console.error('[processSessionRealtimeDeduction] 获取费率失败', e);
  }

  return runTransaction(db, async transaction => {
    // The session is the idempotency lock. Concurrent devices retry against its
    // updated nextDeductionAt and therefore cannot charge the same interval twice.
    const latestSessionDoc = await transaction.get(sessionRef);
    if (!latestSessionDoc.exists()) return { deducted: 0, count: 0 };

    const latestData = latestSessionDoc.data() as any;
    if (!latestData.realtimeDeductionsEnabled || latestData.status !== 'pending') {
      return { deducted: 0, count: 0 };
    }

    const latestNextDeductionAt: Date | null = latestData.nextDeductionAt?.toDate?.() ?? null;
    if (!latestNextDeductionAt || now < latestNextDeductionAt) {
      return { deducted: 0, count: 0 };
    }

    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists()) return { deducted: 0, count: 0 };

    // Preserve fractional precision: 25 points/hour is 12.5 points/half-hour.
    const halfHourPoints = hourlyRate / 2;
    const msOverdue = now.getTime() - latestNextDeductionAt.getTime();
    const missedIntervals = Math.floor(msOverdue / (30 * 60 * 1000));
    const totalIntervals = 1 + missedIntervals;
    const totalNewDeduction = halfHourPoints * totalIntervals;
    const newNextDeductionAt = new Date(
      latestNextDeductionAt.getTime() + totalIntervals * 30 * 60 * 1000
    );

    const userData = userDoc.data() as User;
    const currentPoints = userData.membership?.points || 0;
    const affordability = calculateCheckoutAffordability(currentPoints, totalNewDeduction);
    if (!affordability.canCheckout) {
      return {
        deducted: 0,
        count: 0,
        insufficient: {
          currentPoints,
          pointsDue: totalNewDeduction,
          shortfall: affordability.shortfall,
          hoursDue: 0.5 * totalIntervals,
          deductionCountTarget: (latestData.deductionCount || 1) + totalIntervals
        }
      };
    }

    transaction.update(userRef, {
      'membership.points': affordability.balanceAfterCharge,
      'membership.totalVisitHours': (userData.membership?.totalVisitHours || 0) + 0.5 * totalIntervals,
      updatedAt: Timestamp.fromDate(now)
    });
    transaction.update(sessionRef, {
      realtimePointsDeducted: (latestData.realtimePointsDeducted || 0) + totalNewDeduction,
      nextDeductionAt: Timestamp.fromDate(newNextDeductionAt),
      deductionCount: (latestData.deductionCount || 1) + totalIntervals,
      updatedAt: Timestamp.fromDate(now)
    });
    transaction.set(pointsRecordRef, {
      userId,
      userName: latestData.userName || userData.displayName,
      type: 'spend',
      amount: totalNewDeduction,
      source: 'visit',
      description: `驻店计时扣费 (${0.5 * totalIntervals}小时，共${totalNewDeduction}积分)`,
      relatedId: sessionId,
      balance: affordability.balanceAfterCharge,
      createdAt: Timestamp.fromDate(now),
      createdBy: 'system'
    });

    return { deducted: totalNewDeduction, count: totalIntervals };
  });
};

const markCheckoutAwaitingReload = async (
  sessionId: string,
  details: {
    pointsDueNow: number;
    shortfall: number;
    durationMinutes: number;
    durationHours: number;
    forceHours?: number;
    realtimeHoursAdjustment?: number;
    realtimeDeductionCountTarget?: number;
    requestedBy: string;
    requestedStoreId?: string;
    requestedAt: Date;
  }
) => {
  await updateDoc(doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, sessionId), {
    checkoutPending: {
      status: 'awaiting_reload',
      pointsDueNow: details.pointsDueNow,
      shortfall: details.shortfall,
      minimumReloadAmount: MINIMUM_RELOAD_AMOUNT_RM,
      durationMinutes: details.durationMinutes,
      durationHours: details.durationHours,
      ...(details.forceHours !== undefined ? { forceHours: details.forceHours } : {}),
      ...(details.realtimeHoursAdjustment !== undefined
        ? { realtimeHoursAdjustment: details.realtimeHoursAdjustment }
        : {}),
      ...(details.realtimeDeductionCountTarget !== undefined
        ? { realtimeDeductionCountTarget: details.realtimeDeductionCountTarget }
        : {}),
      requestedBy: details.requestedBy,
      ...(details.requestedStoreId ? { requestedStoreId: details.requestedStoreId } : {}),
      requestedAt: Timestamp.fromDate(details.requestedAt)
    },
    updatedAt: Timestamp.fromDate(new Date())
  });
};

/**
 * 完成驻店记录（Check-out）
 */
export const completeVisitSession = async (
  sessionId: string,
  checkOutBy: string,
  currentStoreId?: string,
  forceHours?: number // 强制使用指定小时数（忘记check-out时）
): Promise<{ success: boolean; pointsDeducted?: number; rebatePoints?: number; error?: string }> => {
  try {
    const sessionDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, sessionId));
    if (!sessionDoc.exists()) {
      return { success: false, error: '驻店记录不存在' };
    }

    const sessionData = sessionDoc.data() as any;
    
    // 转换 redemptions 数组中的日期字段
    const redemptions = (sessionData.redemptions || []).map((r: any) => ({
      ...r,
      redeemedAt: r.redeemedAt?.toDate?.() || (r.redeemedAt instanceof Date ? r.redeemedAt : new Date(r.redeemedAt))
    }));
    
    const session: VisitSession = {
      id: sessionDoc.id,
      ...sessionData,
      checkInAt: sessionData.checkInAt?.toDate?.() || new Date(sessionData.checkInAt),
      checkOutAt: sessionData.checkOutAt?.toDate?.() || sessionData.checkOutAt,
      calculatedAt: sessionData.calculatedAt?.toDate?.() || sessionData.calculatedAt,
      checkoutPending: sessionData.checkoutPending ? {
        ...sessionData.checkoutPending,
        requestedAt: sessionData.checkoutPending.requestedAt?.toDate?.() || new Date(sessionData.checkoutPending.requestedAt)
      } : undefined,
      createdAt: sessionData.createdAt?.toDate?.() || new Date(sessionData.createdAt),
      updatedAt: sessionData.updatedAt?.toDate?.() || new Date(sessionData.updatedAt),
      redemptions: redemptions
    };

    if (session.status !== 'pending') {
      return { success: false, error: '该驻店记录已完成或已过期' };
    }

    // 检查门店一致性 (非强制结算且提供了门店ID时)
    if (currentStoreId && session.storeId && session.storeId !== currentStoreId) {
      return { success: false, error: `签退失败：该记录属于[${session.storeName || '其他会所'}]，请在原会所进行签退` };
    }

    const now = new Date();
    let durationMinutes: number;
    let durationHours: number;

    const pendingCheckout = session.checkoutPending?.status === 'awaiting_reload'
      ? session.checkoutPending
      : undefined;
    const effectiveForceHours = forceHours ?? pendingCheckout?.forceHours;
    const checkoutRequestedAt = pendingCheckout?.requestedAt || now;

    if (pendingCheckout) {
      durationHours = pendingCheckout.durationHours;
      durationMinutes = pendingCheckout.durationMinutes;
    } else if (effectiveForceHours !== undefined) {
      // 忘记check-out，使用强制小时数
      durationHours = effectiveForceHours;
      durationMinutes = effectiveForceHours * 60;
    } else {
      // 正常计算
      durationMinutes = Math.floor((now.getTime() - session.checkInAt.getTime()) / (1000 * 60));
      durationHours = calculateVisitDuration(durationMinutes);
    }

    // 获取当前时期生效的每小时扣除积分（基于签到时间）
    let hourlyRate = 0;
    try {
      const { getCurrentHourlyRate } = await import('./membershipFee');
      // 使用签到时间作为基准日期，确保使用签到时的费率
      hourlyRate = await getCurrentHourlyRate(session.checkInAt);
    } catch (error) {
      console.error('[completeVisitSession] 获取积分扣除配置失败，使用默认值', error);
      // 如果失败，使用默认值
      hourlyRate = 10;
    }

    // 计算应扣除的积分
    let pointsDeducted = 0;
    let realtimeBilledHours: number | undefined;
    let realtimeCheckoutAdjustment = 0;
    let realtimeHoursAdjustment = 0;
    const usesRealtimeDeductions = Boolean(
      session.realtimeDeductionsEnabled && !session.dayPass?.isPurchased
    );
    if (!session.isFirstVisitAfterRenewal) {
      if (session.dayPass?.isPurchased) {
        // Day Pass 逻辑（checkout 时一次性结算）
        const freeHours = session.dayPass.config.freeHours || 3;
        const rateAfter = session.dayPass.config.hourlyRateAfter || 30;
        if (durationHours > freeHours) {
          pointsDeducted = Math.round((durationHours - freeHours) * rateAfter);
        }
      } else if (usesRealtimeDeductions) {
        if (effectiveForceHours !== undefined) {
          const sessionRef = doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, sessionId);
          const latestSessionDoc = await getDoc(sessionRef);
          if (!latestSessionDoc.exists()) throw new Error('驻店记录不存在');

          const latestData = latestSessionDoc.data() as any;
          const targetPoints = Math.round(effectiveForceHours * hourlyRate);
          const alreadyDeducted = Number(latestData.realtimePointsDeducted || 0);
          const deductionCount = Number(latestData.deductionCount || 0);
          const alreadyBilledHours = deductionCount > 0
            ? 1 + Math.max(0, deductionCount - 1) * 0.5
            : 0;
          realtimeCheckoutAdjustment = targetPoints - alreadyDeducted;
          realtimeHoursAdjustment = effectiveForceHours - alreadyBilledHours;

          pointsDeducted = targetPoints;
          realtimeBilledHours = effectiveForceHours;
        } else {
          // Annual Membership 实时扣费模式：先补扣漏掉的区间，checkout 不再额外扣
          const realtimeResult = await processSessionRealtimeDeduction(sessionId, session.userId, checkoutRequestedAt);
          if (realtimeResult.insufficient) {
            await markCheckoutAwaitingReload(sessionId, {
              pointsDueNow: realtimeResult.insufficient.pointsDue,
              shortfall: realtimeResult.insufficient.shortfall,
              durationMinutes,
              durationHours,
              realtimeHoursAdjustment: realtimeResult.insufficient.hoursDue,
              realtimeDeductionCountTarget: realtimeResult.insufficient.deductionCountTarget,
              requestedBy: checkOutBy,
              requestedStoreId: currentStoreId,
              requestedAt: checkoutRequestedAt
            });
            return {
              success: false,
              error: `积分不足，无法 Check-out。当前 ${realtimeResult.insufficient.currentPoints} 分，需扣 ${realtimeResult.insufficient.pointsDue} 分，还需充值 ${realtimeResult.insufficient.shortfall} 分（最低充值 RM ${MINIMUM_RELOAD_AMOUNT_RM}）`
            };
          }
          // 读取最新已扣总量，写入 session 作为 pointsDeducted 汇总字段
          const latestDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, sessionId));
          const latestData = latestDoc.exists() ? latestDoc.data() : undefined;
          pointsDeducted = latestData?.realtimePointsDeducted || session.realtimePointsDeducted || 0;
          const deductionCount = latestData?.deductionCount || session.deductionCount || 0;
          realtimeBilledHours = deductionCount > 0 ? 1 + Math.max(0, deductionCount - 1) * 0.5 : 0;
        }
      } else {
        // 旧逻辑：按总时长一次性扣费
        pointsDeducted = Math.round(durationHours * hourlyRate);
      }
    }

    const { getPointsConfig } = await import('./pointsConfig');
    const pointsConfig = await getPointsConfig();
    const dayPassPoints = session.dayPass?.isPurchased
      ? Number(session.dayPass.config.cost || 0)
      : 0;
    const totalPointsDeducted = pointsDeducted + dayPassPoints;
    const rebate = calculateRebateReward(totalPointsDeducted, pointsConfig?.purchase?.rebatePercent);
    const rebatePoints = rebate.points;
    const pointsDueNow = usesRealtimeDeductions ? realtimeCheckoutAdjustment : pointsDeducted;
    const userRef = doc(db, GLOBAL_COLLECTIONS.USERS, session.userId);
    const settlement = await runTransaction(db, async transaction => {
      const latestUserDoc = await transaction.get(userRef);
      if (!latestUserDoc.exists()) throw new Error('用户不存在');

      const latestUser = latestUserDoc.data() as User;
      const latestPoints = latestUser.membership?.points || 0;
      const latestAffordability = calculateCheckoutAffordability(latestPoints, pointsDueNow);
      if (!latestAffordability.canCheckout) {
        return {
          settled: false as const,
          currentPoints: latestPoints,
          pointsAfterCharge: latestAffordability.balanceAfterCharge,
          shortfall: latestAffordability.shortfall,
          userData: latestUser
        };
      }

      const finalPoints = latestAffordability.balanceAfterCharge + rebatePoints;
      const userUpdateData: Record<string, unknown> = {
        'membership.points': finalPoints,
        'membership.currentVisitSessionId': null,
        updatedAt: Timestamp.fromDate(now)
      };
      if (usesRealtimeDeductions && realtimeHoursAdjustment !== 0) {
        userUpdateData['membership.totalVisitHours'] = Math.max(
          0,
          (latestUser.membership?.totalVisitHours || 0) + realtimeHoursAdjustment
        );
      } else if (!usesRealtimeDeductions && !session.dayPass?.isPurchased) {
        userUpdateData['membership.totalVisitHours'] =
          (latestUser.membership?.totalVisitHours || 0) + durationHours;
      }
      transaction.update(userRef, userUpdateData);

      return {
        settled: true as const,
        currentPoints: latestPoints,
        pointsAfterCharge: latestAffordability.balanceAfterCharge,
        finalPoints,
        shortfall: 0,
        userData: latestUser
      };
    });

    if (!settlement.settled) {
      await markCheckoutAwaitingReload(sessionId, {
        pointsDueNow,
        shortfall: settlement.shortfall,
        durationMinutes,
        durationHours,
        forceHours: effectiveForceHours,
        realtimeHoursAdjustment: usesRealtimeDeductions ? realtimeHoursAdjustment : undefined,
        realtimeDeductionCountTarget: usesRealtimeDeductions && effectiveForceHours !== undefined
          ? (effectiveForceHours <= 1 ? 1 : 1 + Math.round((effectiveForceHours - 1) / 0.5))
          : undefined,
        requestedBy: pendingCheckout?.requestedBy || checkOutBy,
        requestedStoreId: pendingCheckout?.requestedStoreId || currentStoreId,
        requestedAt: checkoutRequestedAt
      });
      return {
        success: false,
        error: `积分不足，无法 Check-out。当前 ${settlement.currentPoints} 分，需扣 ${Math.max(0, pointsDueNow)} 分，还需充值 ${settlement.shortfall} 分（最低充值 RM ${MINIMUM_RELOAD_AMOUNT_RM}）`
      };
    }

    const pointsAfterCharge = settlement.pointsAfterCharge;
    const finalPoints = settlement.finalPoints;

    let pointsRecordId: string | undefined;
    let rebatePointsRecordId: string | undefined;

    if (usesRealtimeDeductions) {
      // 实时扣费模式：余额已实时扣除，checkout 时才生成一条可见的汇总流水
      if (pointsDeducted > 0) {
        const { createPointsRecord } = await import('./pointsRecords');
        const billedHours = realtimeBilledHours ?? durationHours;
        const pointsRecord = await createPointsRecord({
          userId: session.userId,
          userName: session.userName,
          type: 'spend',
          amount: pointsDeducted,
          source: 'visit',
          description: `驻店计时扣费 (${billedHours}小时，共${pointsDeducted}积分)`,
          relatedId: sessionId,
          isVisitSessionSummary: true,
          balance: pointsAfterCharge,
          createdBy: checkOutBy
        });
        pointsRecordId = pointsRecord?.id;
      }

      if (rebatePoints > 0) {
        const { createPointsRecord } = await import('./pointsRecords');
        const rebateRecord = await createPointsRecord({
          userId: session.userId,
          userName: session.userName,
          type: 'earn',
          amount: rebatePoints,
          source: 'visit',
          description: `驻店消费返点 ${rebate.rate}% (${rebatePoints}积分)`,
          relatedId: sessionId,
          balance: finalPoints,
          createdBy: checkOutBy
        });
        rebatePointsRecordId = rebateRecord?.id;
      }

    } else {
      // 传统模式：一次性扣费
      const newPoints = pointsAfterCharge;

      if (pointsDeducted > 0) {
        const { createPointsRecord } = await import('./pointsRecords');
        let description = `驻店时长费用 (${durationHours}小时 × ${hourlyRate}积分/小时)`;
        if (session.dayPass?.isPurchased) {
          const freeHours = session.dayPass.config.freeHours || 3;
          const rateAfter = session.dayPass.config.hourlyRateAfter || 30;
          description = `Day Pass 超时费用 (总${durationHours}h, 免${freeHours}h, 超时费${rateAfter}/h)`;
        } else if (session.isFirstVisitAfterRenewal) {
          description = `续费后首次驻店 (免单)`;
        }
        const pointsRecord = await createPointsRecord({
          userId: session.userId,
          userName: session.userName,
          type: 'spend',
          amount: pointsDeducted,
          source: 'visit',
          description,
          relatedId: sessionId,
          balance: newPoints,
          createdBy: checkOutBy
        });
        pointsRecordId = pointsRecord?.id;
      }

      if (rebatePoints > 0) {
        const { createPointsRecord } = await import('./pointsRecords');
        const rebateRecord = await createPointsRecord({
          userId: session.userId,
          userName: session.userName,
          type: 'earn',
          amount: rebatePoints,
          source: 'visit',
          description: `驻店消费返点 ${rebate.rate}% (${rebatePoints}积分)`,
          relatedId: sessionId,
          balance: finalPoints,
          createdBy: checkOutBy
        });
        rebatePointsRecordId = rebateRecord?.id;
      }

    }

    // 处理兑换的雪茄：确保所有记录都保存到redemptionRecords集合，然后统计、创建订单和出库记录
    let orderId: string | undefined;
    let outboundOrderId: string | undefined;
    
    // redemptionRecords 是兑换事实来源；即使 session 镜像同步失败，也必须据此生成订单。
    {
      try {
        // 0. 确保所有兑换记录都保存到redemptionRecords集合的同一个文档中
        // 文档ID = visitSessionId，包含该session的所有兑换记录
        const { getRedemptionRecordsBySession } = await import('./redemption');
        let canonicalRecords = await getRedemptionRecordsBySession(sessionId);
        const canonicalCompletedTotals = new Map<string, number>();
        aggregateCompletedRedemptions(canonicalRecords).forEach(record => {
          canonicalCompletedTotals.set(record.cigarId, record.quantity);
        });

        // 收集需要添加到redemptionRecords文档的记录项
        const recordsToAdd: Array<{
          id: string;
          userId: string;
          userName?: string;
          cigarId: string;
          cigarName: string;
          quantity: number;
          status: 'completed';
          dayKey: string;
          hourKey: string;
          redemptionIndex: number;
          isDayPass?: boolean;
          redeemedAt: Date;
          redeemedBy: string;
          createdAt: Date;
        }> = [];

        const sessionTotals = new Map<string, { cigarName: string; quantity: number; redemption: NonNullable<VisitSession['redemptions']>[number] }>();
        for (const redemption of session.redemptions || []) {
          const cigarId = redemption.cigarId?.trim();
          if (!cigarId || redemption.quantity <= 0) continue;

          const existing = sessionTotals.get(cigarId);
          if (existing) {
            existing.quantity += redemption.quantity;
          } else {
            sessionTotals.set(cigarId, {
              cigarName: redemption.cigarName,
              quantity: redemption.quantity,
              redemption
            });
          }
        }

        for (const [cigarId, sessionTotal] of sessionTotals) {
          const missingQuantity = sessionTotal.quantity - (canonicalCompletedTotals.get(cigarId) || 0);
          if (missingQuantity <= 0) continue;

          const redemptionDate = sessionTotal.redemption.redeemedAt || now;
          const dayKey = redemptionDate.toISOString().split('T')[0];
          const hourKey = redemptionDate.toISOString().split(':')[0];
          const { getDailyRedemptions } = await import('./redemption');
          const dailyRedemptions = await getDailyRedemptions(session.userId, dayKey);
          const redemptionIndex = dailyRedemptions.filter(r => r.status === 'completed').length + 1;

          recordsToAdd.push({
            id: sessionTotal.redemption.recordId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            userId: session.userId,
            userName: session.userName,
            cigarId,
            cigarName: sessionTotal.cigarName,
            quantity: missingQuantity,
            status: 'completed',
            dayKey,
            hourKey,
            redemptionIndex,
            isDayPass: !!session.dayPass?.isPurchased,
            redeemedAt: redemptionDate,
            redeemedBy: sessionTotal.redemption.redeemedBy || checkOutBy,
            createdAt: redemptionDate
          });
        }

        // 如果有需要添加的记录，使用事务更新文档
        if (recordsToAdd.length > 0) {
          try {
            await runTransaction(db, async (transaction) => {
              const docRef = doc(db, GLOBAL_COLLECTIONS.REDEMPTION_RECORDS, sessionId);
              const docSnap = await transaction.get(docRef);
              
              if (docSnap.exists()) {
                // 文档已存在，使用 arrayUnion 添加新记录
                const itemsToAdd = recordsToAdd.map(item => ({
                  ...item,
                  redeemedAt: Timestamp.fromDate(item.redeemedAt),
                  createdAt: Timestamp.fromDate(item.createdAt)
                }));
                transaction.update(docRef, {
                  redemptions: arrayUnion(...itemsToAdd),
                  updatedAt: Timestamp.fromDate(now)
                });
              } else {
                // 文档不存在，创建新文档
                const userDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.USERS, session.userId));
                const userData = userDoc.exists() ? userDoc.data() as User : null;
                
                const newDoc = {
                  visitSessionId: sessionId,
                  userId: session.userId,
                  userName: session.userName || userData?.displayName,
                  redemptions: recordsToAdd.map(item => ({
                    ...item,
                    redeemedAt: Timestamp.fromDate(item.redeemedAt),
                    createdAt: Timestamp.fromDate(item.createdAt)
                  })),
                  createdAt: Timestamp.fromDate(now),
                  updatedAt: Timestamp.fromDate(now)
                };
                transaction.set(docRef, newDoc);
              }
            });
            canonicalRecords = await getRedemptionRecordsBySession(sessionId);
          } catch (error: any) {
            console.warn(`[completeVisitSession] 创建兑换记录到redemptionRecords失败:`, error);
            // 不阻断流程，继续处理
          }
        }

        // 1. 以 redemptionRecords 的已确认记录作为订单与出库的唯一数量来源。
        const confirmedRedemptions = areRedemptionsReadyForSettlement(canonicalRecords)
          ? aggregateCompletedRedemptions(canonicalRecords)
          : [];

        // 2. 获取雪茄信息并准备订单项
        const orderItems: Array<{ cigarId: string; quantity: number; price: number }> = [];
        const outboundItems: Array<{
          cigarId: string;
          cigarName: string;
          itemType: 'cigar';
          quantity: number;
          unitPrice: number;
          subtotal: number;
        }> = [];
        
        let outboundTotalQty = 0;
        let outboundTotalValue = 0;

        for (const { cigarId, cigarName, quantity } of confirmedRedemptions) {
          const cigar = await getCigarById(cigarId);
          if (!cigar) {
            console.warn(`[completeVisitSession] 雪茄不存在: ${cigarId}`);
            continue;
          }

          const unitPrice = cigar.price || 0;
          orderItems.push({
            cigarId,
            quantity,
            price: 0 // 兑换订单金额为0
          });

          outboundItems.push({
            cigarId,
            cigarName: cigar.name,
            itemType: 'cigar',
            quantity,
            unitPrice,
            subtotal: unitPrice * quantity
          });

          outboundTotalQty += quantity;
          outboundTotalValue += unitPrice * quantity;
        }

        // 3. 创建订单（金额为0）
        if (orderItems.length > 0) {
          // 生成订单ID
          const { start: startOfMonth, end: endOfMonth } = getRedemptionOrderMonth(now);
          
          // 查询当月订单数量
          const qCount = query(
            collection(db, COLLECTIONS.ORDERS),
            where('createdAt', '>=', Timestamp.fromDate(startOfMonth)),
            where('createdAt', '<=', Timestamp.fromDate(endOfMonth))
          );
          const snap = await getDocs(qCount);
          const newOrderId = await resolveRedemptionOrderId({
            date: now,
            getMonthlyCount: async () => snap.size,
            exists: async id => (await getDoc(doc(db, COLLECTIONS.ORDERS, id))).exists(),
          });

          const orderData: Omit<Order, 'id'> = {
            userId: session.userId,
            items: orderItems.map(item => ({
              cigarId: item.cigarId,
              quantity: item.quantity,
              price: item.price
            })),
            total: 0, // 兑换订单金额为0
            status: 'completed',
            completedStatusDisplay: true,
            source: {
              type: 'direct',
              note: `驻店兑换订单 (Session: ${sessionId})`
            },
            payment: {
              method: 'bank_transfer',
              paidAt: now
            },
            shipping: {
              address: '会所兑换'
            },
            createdAt: now,
            updatedAt: now
          };

          // 清洗数据：移除 undefined 字段
          const sanitizedOrderData: any = {};
          Object.keys(orderData).forEach(key => {
            const value = (orderData as any)[key];
            if (value !== undefined) {
              sanitizedOrderData[key] = value;
            }
          });
          
          await setDoc(doc(db, COLLECTIONS.ORDERS, newOrderId), {
            ...sanitizedOrderData,
            createdAt: Timestamp.fromDate(now),
            updatedAt: Timestamp.fromDate(now)
          });
          
          orderId = newOrderId;

          // 4. 创建出库记录（会自动扣除库存）
          if (outboundItems.length > 0) {
            const outboundOrderData: Omit<OutboundOrder, 'id' | 'updatedAt'> = {
              referenceNo: newOrderId,
              type: 'sale',
              reason: `驻店兑换出库 (Session: ${sessionId})`,
              items: outboundItems,
              totalQuantity: outboundTotalQty,
              totalValue: outboundTotalValue,
              orderId: newOrderId,
              userId: session.userId,
              userName: session.userName,
              status: 'completed',
              operatorId: checkOutBy,
              createdAt: now
            };

            outboundOrderId = await createOutboundOrder(outboundOrderData);
          }
        }
      } catch (error: any) {
        console.error('[completeVisitSession] 处理兑换雪茄失败:', error);
        // 不阻断 check-out 流程，只记录错误
      }
    }

    // 实时扣费模式下，按已执行的 0.5 小时扣费次数记录计费时长
    const billedHours = usesRealtimeDeductions
      ? (realtimeBilledHours ?? durationHours)
      : durationHours;

    // 更新驻店记录
    await updateDoc(doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, sessionId), {
      checkOutAt: Timestamp.fromDate(now),
      checkOutBy,
      durationMinutes,
      durationHours: billedHours,
      calculatedAt: Timestamp.fromDate(now),
      pointsDeducted: totalPointsDeducted,
      pointsRecordId: pointsRecordId || null,
      rebatePoints,
      rebatePointsRecordId: rebatePointsRecordId || null,
      orderId: orderId || null,
      outboundOrderId: outboundOrderId || null,
      checkoutPending: null,
      ...(usesRealtimeDeductions && effectiveForceHours !== undefined ? {
        realtimePointsDeducted: pointsDeducted,
        deductionCount: effectiveForceHours <= 1
          ? 1
          : 1 + Math.round((effectiveForceHours - 1) / 0.5)
      } : {}),
      status: 'completed',
      updatedAt: Timestamp.fromDate(now)
    });

    return { success: true, pointsDeducted: totalPointsDeducted, rebatePoints };
  } catch (error: any) {
    return { success: false, error: error.message || '完成驻店记录失败' };
  }
};

/**
 * Finalize redemption orders once a checked-out session has no pending choices.
 * Safe to call after checkout and after every redemption confirmation.
 */
export const reconcileCompletedSessionRedemptions = async (
  sessionId: string,
  operatorId: string
): Promise<{ success: boolean; deferred?: boolean; orderId?: string; error?: string }> => {
  try {
    const sessionRef = doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, sessionId);
    const sessionSnap = await getDoc(sessionRef);
    if (!sessionSnap.exists()) return { success: false, error: '驻店记录不存在' };

    const session = processVisitSessionData(sessionSnap.data(), sessionSnap.id);
    if (session.status !== 'completed') return { success: true, deferred: true };

    const { getRedemptionRecordsBySession } = await import('./redemption');
    const canonicalRecords = await getRedemptionRecordsBySession(sessionId);
    if (!areRedemptionsReadyForSettlement(canonicalRecords)) {
      return { success: true, deferred: true };
    }

    const confirmedRedemptions = aggregateCompletedRedemptions(canonicalRecords);
    if (confirmedRedemptions.length === 0) return { success: true, deferred: true };

    const checkoutAt = session.checkOutAt instanceof Date ? session.checkOutAt : new Date();
    const sourceNote = `驻店兑换订单 (Session: ${sessionId})`;
    const orderItems: Order['items'] = [];
    const desiredOutboundItems: OutboundOrder['items'] = [];

    for (const redemption of confirmedRedemptions) {
      const cigar = await getCigarById(redemption.cigarId);
      if (!cigar) return { success: false, error: `雪茄不存在: ${redemption.cigarName}` };

      const unitPrice = cigar.price || 0;
      orderItems.push({ cigarId: cigar.id, quantity: redemption.quantity, price: 0 });
      desiredOutboundItems.push({
        cigarId: cigar.id,
        cigarName: cigar.name,
        itemType: 'cigar',
        quantity: redemption.quantity,
        unitPrice,
        subtotal: unitPrice * redemption.quantity
      });
    }

    let orderId = session.orderId;
    if (!orderId) {
      const userOrders = await getDocs(query(
        collection(db, COLLECTIONS.ORDERS),
        where('userId', '==', session.userId)
      ));
      const existingOrder = userOrders.docs.find(order => order.data()?.source?.note === sourceNote);
      orderId = existingOrder?.id;
    }

    if (!orderId) {
      const { start: startOfMonth, end: endOfMonth } = getRedemptionOrderMonth(checkoutAt);
      const monthlyOrders = await getDocs(query(
        collection(db, COLLECTIONS.ORDERS),
        where('createdAt', '>=', Timestamp.fromDate(startOfMonth)),
        where('createdAt', '<=', Timestamp.fromDate(endOfMonth))
      ));

      orderId = await resolveRedemptionOrderId({
        date: checkoutAt,
        getMonthlyCount: async () => monthlyOrders.size,
        exists: async id => (await getDoc(doc(db, COLLECTIONS.ORDERS, id))).exists(),
      });
    }

    const existingOutboundByOrderId = await getDocs(query(
      collection(db, COLLECTIONS.OUTBOUND_ORDERS),
      where('orderId', '==', orderId)
    ));
    const existingOutboundByReference = await getDocs(query(
      collection(db, COLLECTIONS.OUTBOUND_ORDERS),
      where('referenceNo', '==', orderId)
    ));
    const existingOutboundDocs = new Map(
      [...existingOutboundByOrderId.docs, ...existingOutboundByReference.docs]
        .map(outbound => [outbound.id, outbound] as const)
    );
    const existingOutboundTotals = new Map<string, number>();
    existingOutboundDocs.forEach(outbound => {
      ((outbound.data().items || []) as OutboundOrder['items']).forEach(item => {
        existingOutboundTotals.set(item.cigarId, (existingOutboundTotals.get(item.cigarId) || 0) + item.quantity);
      });
    });

    for (const [cigarId, existingQuantity] of existingOutboundTotals) {
      const desiredQuantity = desiredOutboundItems.find(item => item.cigarId === cigarId)?.quantity || 0;
      if (existingQuantity > desiredQuantity) {
        return { success: false, error: '现有兑换出库数量高于兑换记录，请管理员检查库存记录' };
      }
    }

    const orderSnapshot = await getDoc(doc(db, COLLECTIONS.ORDERS, orderId));
    await setDoc(doc(db, COLLECTIONS.ORDERS, orderId), {
      userId: session.userId,
      items: orderItems,
      total: 0,
      status: 'completed',
      ...(!orderSnapshot.exists() ? { completedStatusDisplay: true } : {}),
      source: { type: 'direct', note: sourceNote },
      payment: { method: 'bank_transfer', paidAt: Timestamp.fromDate(checkoutAt) },
      shipping: { address: '会所兑换' },
      ...(session.storeId ? { storeId: session.storeId } : {}),
      createdAt: Timestamp.fromDate(checkoutAt),
      updatedAt: Timestamp.fromDate(new Date())
    }, { merge: true });

    const deltaItems = desiredOutboundItems
      .map(item => ({ ...item, quantity: item.quantity - (existingOutboundTotals.get(item.cigarId) || 0) }))
      .filter(item => item.quantity > 0)
      .map(item => ({ ...item, subtotal: (item.unitPrice || 0) * item.quantity }));

    let outboundOrderId = session.outboundOrderId || existingOutboundDocs.values().next().value?.id;
    if (deltaItems.length > 0) {
      outboundOrderId = await createOutboundOrder({
        referenceNo: orderId,
        type: 'sale',
        reason: `驻店兑换出库 (Session: ${sessionId})`,
        items: deltaItems,
        totalQuantity: deltaItems.reduce((sum, item) => sum + item.quantity, 0),
        totalValue: deltaItems.reduce((sum, item) => sum + (item.subtotal || 0), 0),
        orderId,
        userId: session.userId,
        userName: session.userName,
        status: 'completed',
        operatorId,
        ...(session.storeId ? { storeId: session.storeId } : {}),
        createdAt: checkoutAt
      });
    }

    await updateDoc(sessionRef, {
      orderId,
      outboundOrderId: outboundOrderId || null,
      updatedAt: Timestamp.fromDate(new Date())
    });

    return { success: true, orderId };
  } catch (error: any) {
    console.error('[reconcileCompletedSessionRedemptions] 兑换订单同步失败:', error);
    return { success: false, error: error.message || '兑换订单同步失败' };
  }
};

/**
 * 获取用户的待处理驻店记录
 */
export const getPendingVisitSession = async (userId: string): Promise<VisitSession | null> => {
  try {
    const q = query(
      collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
      where('userId', '==', userId),
      where('status', '==', 'pending'),
      orderBy('checkInAt', 'desc'),
      limit(1)
    );

    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      return null;
    }

    const docSnap = snapshot.docs[0];
    const data = docSnap.data();
    const session = processVisitSessionData(data, docSnap.id);
    return session;
  } catch (error: any) {
    console.error('[getPendingVisitSession] 查询失败:', error);
    // 如果是索引错误，抛出以便上层处理
    if (error.code === 'failed-precondition' || error.message?.includes('index')) {
      throw error;
    }
    return null;
  }
};

/**
 * 实时监听用户当前待处理的驻店记录。
 * Check-out 余额不足时，管理员会把 checkoutPending 写回会话；用户端
 * 需要立即看到 Reload 状态，而不是等待下一次轮询。
 */
export const subscribeToVisitSession = (
  sessionId: string,
  onChange: (session: VisitSession | null) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  return onSnapshot(
    doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, sessionId),
    snapshot => {
      onChange(snapshot.exists() ? processVisitSessionData(snapshot.data(), snapshot.id) : null);
    },
    error => {
      console.warn('[subscribeToVisitSession] 实时监听失败:', error);
      onError?.(error);
    }
  );
};

/**
 * 获取用户的所有驻店记录
 */
export const getUserVisitSessions = async (
  userId: string,
  limitCount?: number,
  storeId?: string
): Promise<VisitSession[]> => {
  if (!limitCount) limitCount = 200;
  try {
    let q = query(
      collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
      where('userId', '==', userId),
      orderBy('checkInAt', 'desc')
    );

    if (storeId) {
      q = query(q, where('storeId', '==', storeId));
    }

    if (limitCount > 0) {
      q = query(q, limit(limitCount));
    }

    const snapshot = await getDocs(q);
    const sessions = snapshot.docs.map(doc => processVisitSessionData(doc.data(), doc.id));
    
    return sessions;
  } catch (error: any) {
    console.error('[getUserVisitSessions] 查询失败:', error);
    // 如果是索引错误，尝试不使用orderBy
    if (error.code === 'failed-precondition' || error.message?.includes('index')) {
      try {
        let q: Query = query(
          collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
          where('userId', '==', userId)
        );
        if (storeId) {
          q = query(q, where('storeId', '==', storeId));
        }
        const snapshot = await getDocs(q);
        const sessions = snapshot.docs.map(doc => processVisitSessionData(doc.data(), doc.id));
        // An unordered limit can omit recent visits when the composite index is missing.
        sessions.sort((a, b) => b.checkInAt.getTime() - a.checkInAt.getTime());
        return limitCount > 0 ? sessions.slice(0, limitCount) : sessions;
      } catch (retryError) {
        console.error('[getUserVisitSessions] 重试查询也失败:', retryError);
        return [];
      }
    }
    return [];
  }
};

/**
 * 获取所有待处理的驻店记录（包括所有pending状态的记录）
 */
export const getAllPendingVisitSessions = async (storeId?: string): Promise<VisitSession[]> => {
  try {
    let q = query(
      collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
      where('status', '==', 'pending'),
      orderBy('checkInAt', 'desc')
    );

    if (storeId) {
      q = query(q, where('storeId', '==', storeId));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => processVisitSessionData(doc.data(), doc.id));
  } catch (error: any) {
    // 如果查询失败（可能是缺少索引），返回空数组
    console.error('获取待处理驻店记录失败:', error);
    return [];
  }
};

export const subscribeToPendingVisitSessions = (
  storeId: string | undefined,
  onChange: (sessions: VisitSession[]) => void,
  onError: (error: Error) => void
): Unsubscribe => {
  let pendingQuery = query(
    collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
    where('status', '==', 'pending')
  );
  if (storeId) pendingQuery = query(pendingQuery, where('storeId', '==', storeId));
  return onSnapshot(pendingQuery, snapshot => {
    const sessions = snapshot.docs.map(entry => processVisitSessionData(entry.data(), entry.id));
    sessions.sort((a, b) => b.checkInAt.getTime() - a.checkInAt.getTime());
    onChange(sessions);
  }, onError);
};

/**
 * 获取所有驻店记录（包括所有状态）
 */
export const getAllVisitSessions = async (limitCount?: number, storeId?: string): Promise<VisitSession[]> => {
  try {
    let q = query(
      collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
      orderBy('checkInAt', 'desc')
    );
    
    if (storeId) {
      q = query(q, where('storeId', '==', storeId));
    }
    
    // 如果指定了 limitCount，则应用限制；否则加载所有数据
    if (limitCount !== undefined && limitCount > 0) {
      q = query(q, limit(limitCount));
    }

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => processVisitSessionData(doc.data(), doc.id));
  } catch (error: any) {
    console.error('获取所有驻店记录失败:', error);
    return [];
  }
};

/**
 * 获取所有待处理的驻店记录（超过24小时未check-out）
 */
export const getExpiredVisitSessions = async (): Promise<VisitSession[]> => {
  try {
    const expireTime = new Date();
    expireTime.setHours(expireTime.getHours() - 24); // 24小时前

    const q = query(
      collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
      where('status', '==', 'pending'),
      orderBy('checkInAt', 'asc')
    );

    const snapshot = await getDocs(q);
    const sessions: VisitSession[] = [];

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const checkInAt = data.checkInAt?.toDate?.() || new Date(data.checkInAt);
      // 检查是否超过24小时
      if (checkInAt <= expireTime) {
        sessions.push(processVisitSessionData(data, doc.id));
      }
    });

    return sessions;
  } catch (error: any) {
    // 如果查询失败（可能是缺少索引），返回空数组
    console.error('获取过期驻店记录失败:', error);
    return [];
  }
};

/**
 * 在驻店期间添加兑换项
 * 使用事务确保所有兑换记录都写入同一个文档，避免并发问题
 */
export const addRedemptionToSession = async (
  sessionId: string,
  redemption: {
    recordId?: string;      // 关联的 redemptionRecords 中的记录项ID（用于更新）
    cigarId: string;
    cigarName: string;
    quantity: number;
    redeemedBy: string;
  }
): Promise<{ success: boolean; error?: string }> => {
  try {
    const now = Timestamp.fromDate(new Date());
    const redemptionRecord = {
      ...redemption,
      redeemedAt: now
    };

    // 使用事务确保原子性更新
    await runTransaction(db, async (transaction) => {
      const sessionRef = doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, sessionId);
      const sessionDoc = await transaction.get(sessionRef);
      
    if (!sessionDoc.exists()) {
        throw new Error('驻店记录不存在');
    }

    const sessionData = sessionDoc.data();
    if (sessionData.status !== 'pending') {
        throw new Error('只能在待处理的驻店记录中添加兑换');
    }

      // 使用 arrayUnion 原子性地添加兑换记录到数组
      // 这样可以确保即使有并发请求，所有记录都会被正确添加
      transaction.update(sessionRef, {
        redemptions: arrayUnion(redemptionRecord),
        updatedAt: now
      });
    });

    return { success: true };
  } catch (error: any) {
    console.error('[addRedemptionToSession] 添加兑换项失败:', error);
    return { success: false, error: error.message || '添加兑换项失败' };
  }
};
 
/**
 * 购买 Day Pass
 * 如果未提供 sessionId，则自动创建新的驻店记录（Check-in）
 */
export const purchaseDayPass = async (
  userId: string,
  storeId: string,
  storeName?: string,
  userName?: string,
  sessionId?: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const userRef = doc(db, GLOBAL_COLLECTIONS.USERS, userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return { success: false, error: '用户不存在' };
 
    const userData = userSnap.data() as User;
    const currentPoints = userData.membership?.points || 0;
 
    // 检查是否已有进行中的会话（如果未提供 sessionId）
    let targetSessionId = sessionId;
    if (!targetSessionId) {
      const pendingSession = await getPendingVisitSession(userId);
      if (pendingSession) {
        targetSessionId = pendingSession.id;
      }
    }
 
    // 获取 Day Pass 配置
    const { getPointsConfig } = await import('./pointsConfig');
    const pointsConfig = await getPointsConfig();
    const dayPassConfig = pointsConfig?.dayPass || { cost: 100, freeHours: 3, hourlyRateAfter: 30, cigarAllowance: 1 };
 
    if (currentPoints < dayPassConfig.cost) return { success: false, error: '积分不足' };
 
    const now = new Date();
    const nowTimestamp = Timestamp.fromDate(now);
 
    await runTransaction(db, async (transaction) => {
      // 1. 扣费
      const newPoints = currentPoints - dayPassConfig.cost;
      transaction.update(userRef, {
        'membership.points': newPoints,
        updatedAt: nowTimestamp
      });
 
      // 2. 如果没有会话，创建新会话；如果有，更新现有会话
      let finalSessionId = targetSessionId;
      if (!finalSessionId) {
        const sessionRef = doc(collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS));
        finalSessionId = sessionRef.id;
        
        transaction.set(sessionRef, {
          userId,
          userName: userName || userData.displayName,
          storeId,
          storeName: storeName || '',
          checkInAt: nowTimestamp,
          checkInBy: userName || userData.displayName,
          status: 'pending',
          checkInType: 'daypass', // 明确记录为 Day Pass 签到
          dayPass: {
            isPurchased: true,
            purchasedAt: nowTimestamp,
            config: dayPassConfig
          },
          createdAt: nowTimestamp,
          updatedAt: nowTimestamp
        });
 
        transaction.update(userRef, {
          'membership.currentVisitSessionId': finalSessionId,
          'membership.lastCheckInAt': nowTimestamp
        });
      } else {
        const sessionRef = doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, finalSessionId);
        transaction.update(sessionRef, {
          checkInType: 'daypass', // 补录 Day Pass 类型
          dayPass: {
            isPurchased: true,
            purchasedAt: nowTimestamp,
            config: dayPassConfig
          },
          updatedAt: nowTimestamp
        });
      }
 
      // 3. 创建积分记录
      const pointsRecordRef = doc(collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS));
      transaction.set(pointsRecordRef, {
        userId,
        userName: userName || userData.displayName,
        type: 'spend',
        amount: dayPassConfig.cost,
        source: 'visit',
        description: '购买 Day Pass',
        relatedId: finalSessionId,
        balance: newPoints,
        createdAt: nowTimestamp
      });
 
      // 4. 自动创建兑换记录 (Redeem 1 cigar)
      const dayKey = now.toISOString().split('T')[0];
      const hourKey = now.toISOString().split(':')[0];
      const recordItemId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const redemptionRecordItem = {
        id: recordItemId,
        userId,
        userName: userName || userData.displayName,
        cigarId: '',
        cigarName: '待选择 (Day Pass 赠送)',
        quantity: 1,
        status: 'pending',
        dayKey,
        hourKey,
        redemptionIndex: 1, // Day Pass 通常是当日第一个
        isDayPass: true,    // Day Pass 兑换不计入会员累计总数
        redeemedAt: nowTimestamp,
        redeemedBy: userId,
        createdAt: nowTimestamp
      };
 
      const redemptionDocRef = doc(db, GLOBAL_COLLECTIONS.REDEMPTION_RECORDS, finalSessionId);
      transaction.set(redemptionDocRef, {
        visitSessionId: finalSessionId,
        userId,
        userName: userName || userData.displayName,
        redemptions: [redemptionRecordItem],
        createdAt: nowTimestamp,
        updatedAt: nowTimestamp
      }, { merge: true });
 
      // 同步更新 session 中的 redemptions
      const sessionRef = doc(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS, finalSessionId);
      transaction.update(sessionRef, {
        redemptions: arrayUnion({
          recordId: recordItemId,
          cigarId: '',
          cigarName: '待选择 (Day Pass 赠送)',
          quantity: 1,
          redeemedBy: userId,
          redeemedAt: nowTimestamp
        })
      });
    });
 
    return { success: true };
  } catch (error: any) {
    console.error('[purchaseDayPass] 失败:', error);
    return { success: false, error: error.message || '购买失败' };
  }
};
