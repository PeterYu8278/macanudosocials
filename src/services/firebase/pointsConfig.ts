// 积分配置服务
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import type { PointsConfig } from '../../types';

/**
 * 获取积分配置
 */
export const getPointsConfig = async (): Promise<PointsConfig | null> => {
  try {
    const docRef = doc(db, 'config', 'points');
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      // 确保 visit 字段存在（向后兼容）
      if (!data.visit) {
        data.visit = { hourlyRate: 10 }; // 默认值
      }
      // 确保 dayPass 字段存在（向后兼容）
      if (!data.dayPass) {
        data.dayPass = {
          cost: 100,
          freeHours: 3,
          hourlyRateAfter: 30,
          cigarAllowance: 1
        };
      }
      return { id: docSnap.id, ...data } as PointsConfig;
    }
    
    // 如果不存在，返回默认配置
    return getDefaultPointsConfig();
  } catch (error) {
    return null;
  }
};

/**
 * 更新积分配置
 */
export const updatePointsConfig = async (
  config: Omit<PointsConfig, 'id' | 'updatedAt'>,
  userId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const docRef = doc(db, 'config', 'points');
    
    await setDoc(docRef, {
      ...config,
      updatedAt: new Date(),
      updatedBy: userId,
    }, { merge: true });
    
    return { success: true };
  } catch (error) {
    return { success: false, error: '更新失败，请重试' };
  }
};

/**
 * 获取默认积分配置
 */
export const getDefaultPointsConfig = (): PointsConfig => {
  return {
    id: 'default',
    purchase: {
      perRinggit: 1,         // 每消费1马币获得1积分
    },
    reload: {
      referrerFirstReload: 0,  // 默认不发放引荐人首充积分
      referredFirstReload: 0,  // 默认不发放被引荐人首充积分
    },
    event: {
      registration: 10,      // 活动报名积分
    },
    visit: {
      hourlyRate: 10,        // 默认每小时扣除10积分
    },
    dayPass: {
      cost: 100,             // 100 积分
      freeHours: 3,          // 3 小时免费
      hourlyRateAfter: 30,   // 3 小时后每个小时扣除 30 积分
      cigarAllowance: 1,     // 允许兑换 1 支雪茄
    },
    updatedAt: new Date(),
    updatedBy: 'system',
  };
};

/**
 * 初始化积分配置（如果不存在）
 */
export const initializePointsConfig = async (userId: string): Promise<void> => {
  try {
    const existing = await getPointsConfig();
    if (!existing) {
      const defaultConfig = getDefaultPointsConfig();
      await updatePointsConfig(defaultConfig, userId);
    }
  } catch (error) {
    // 静默失败
  }
};
