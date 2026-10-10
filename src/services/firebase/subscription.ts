import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  Timestamp 
} from '@/services/firebase/monitoredFirestore';
import { db } from '../../config/firebase';
import type { Subscription } from '../../types';
import { convertFirestoreTimestamps } from './auth';

const SUBSCRIPTION_DOC_ID = 'main_subscription';
const SETTINGS_COLLECTION = 'settings';

/**
 * 获取全局订阅信息
 */
export const getSubscription = async () => {
  try {
    const docRef = doc(db, SETTINGS_COLLECTION, SUBSCRIPTION_DOC_ID);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return {
        id: docSnap.id,
        ...convertFirestoreTimestamps(docSnap.data())
      } as Subscription;
    }
    
    // 如果不存在，返回默认配置
    return getDefaultSubscription();
  } catch (error) {
    console.error('[Subscription Service] getSubscription error:', error);
    return getDefaultSubscription();
  }
};

/**
 * 获取默认订阅配置
 */
export const getDefaultSubscription = (): Subscription => {
  return {
    id: SUBSCRIPTION_DOC_ID,
    status: 'active',
    planId: 'free',
    planName: 'Default Plan',
    expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    quota: {
      maxStores: 1,
      maxSuperAdmins: 1,
      maxAdmins: 3
    },
    accounts: {
      superAdmins: [],
      admins: []
    },
    createdAt: new Date(),
    updatedAt: new Date()
  };
};

/**
 * 更新订阅信息 (仅开发者)
 */
export const updateSubscription = async (data: Partial<Subscription>) => {
  try {
    const docRef = doc(db, SETTINGS_COLLECTION, SUBSCRIPTION_DOC_ID);
    const now = new Date();
    
    await setDoc(docRef, {
      ...data,
      updatedAt: Timestamp.fromDate(now)
    }, { merge: true });
    
    return { success: true };
  } catch (error: any) {
    console.error('[Subscription Service] updateSubscription error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 添加管理员到订阅名单
 */
export const addAdminToSubscription = async (role: 'superAdmin' | 'admin', userId: string) => {
  try {
    const sub = await getSubscription();
    const accounts = sub.accounts;
    
    if (role === 'superAdmin') {
      if (accounts.superAdmins.includes(userId)) return { success: true };
      if (accounts.superAdmins.length >= sub.quota.maxSuperAdmins) {
        return { success: false, error: '超级管理员人数已达上限' };
      }
      accounts.superAdmins.push(userId);
    } else {
      if (accounts.admins.includes(userId)) return { success: true };
      if (accounts.admins.length >= sub.quota.maxAdmins) {
        return { success: false, error: '管理员人数已达上限' };
      }
      accounts.admins.push(userId);
    }
    
    return await updateSubscription({ accounts });
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

/**
 * 从订阅名单移除管理员
 */
export const removeAdminFromSubscription = async (userId: string) => {
  try {
    const sub = await getSubscription();
    const accounts = {
      superAdmins: sub.accounts.superAdmins.filter(id => id !== userId),
      admins: sub.accounts.admins.filter(id => id !== userId)
    };
    
    return await updateSubscription({ accounts });
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};
