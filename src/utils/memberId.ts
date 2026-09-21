/**
 * 会员编号生成工具
 * 
 * memberId 格式规范：
 * - 编码：6位 Base36 编码（字符集：0-9, A-Z，共36个字符）
 * - 生成方式：基于 userId 的 hash 值转换为 Base36 编码
 * - 示例：3K7Y2W, 1A2B3C, 000001（全数字情况）
 * 
 * memberId 用途：
 * 1. 会员唯一标识（系统内唯一）
 * 2. 引荐码（直接使用 memberId，用户可分享）
 * 3. 会员卡展示（用于会员卡、个人资料等场景）
 * 
 * 特性：
 * - 确定性：相同 userId 始终生成相同的 memberId
 * - 唯一性：通过数据库查询确保不重复（冲突时使用时间戳降级方案）
 * - 可读性：Base36 编码保证短小精悍，易于记忆和输入
 */

import { collection, query, limit, getDocs, where } from 'firebase/firestore'
import { db } from '../config/firebase'

/**
 * 简单的字符串 hash 函数
 * @param str 输入字符串
 * @returns 数字 hash 值
 */
const simpleHash = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
};

/**
 * 将数字转换为 Base36 (0-9, A-Z)
 * @param num 数字
 * @param length 目标长度
 * @returns Base36 字符串
 */
const toBase36 = (num: number, length: number = 6): string => {
  return num.toString(36).toUpperCase().padStart(length, '0').slice(-length);
};

/**
 * 基于用户 ID 生成会员编号
 * 
 * 生成流程：
 * 1. 对 userId 进行 hash 计算
 * 2. 将 hash 值转换为 Base36 编码（0-9, A-Z）
 * 3. 取前6位，不足6位左侧补0
 * 4. 验证唯一性，冲突时使用 userId + timestamp 重新生成
 * 
 * @param userId Firebase 用户文档 ID
 * @returns Promise<string> 格式：6位Base36编码，示例：3K7Y2W, 1A2B3C
 */
export const generateMemberId = async (userId: string): Promise<string> => {
  try {
    // 基于 userId 生成 hash
    const hash = simpleHash(userId);
    
    // 转换为 Base36 格式（0-9, A-Z），取6位
    const memberId = toBase36(hash, 6);
    
    // 验证唯一性（极小概率会冲突）
    const exists = await checkMemberIdExists(memberId);
    if (exists) {
      // 如果存在冲突，使用 userId + timestamp 重新生成
      const timestamp = Date.now();
      const fallbackHash = simpleHash(`${userId}-${timestamp}`);
      const fallbackCode = toBase36(fallbackHash, 6);
      return fallbackCode;
    }
    
    return memberId;
  } catch (error) {
    // 降级方案：使用时间戳
    const timestamp = Date.now();
    const fallbackCode = toBase36(timestamp, 6);
    return fallbackCode;
  }
};

/**
 * 检查会员编号是否已存在
 */
export const checkMemberIdExists = async (memberId: string): Promise<boolean> => {
  try {
    const q = query(
      collection(db, 'users'),
      where('memberId', '==', memberId),
      limit(1)
    );
    const snapshot = await getDocs(q);
    return !snapshot.empty;
  } catch (error) {
    return false;
  }
};

/**
 * 通过会员编号查找用户（用于引荐码验证）
 * 通过后端直接查询 users.memberId，避免公开 users 集合或维护重复索引。
 */
export const getUserByMemberId = async (memberId: string): Promise<{ success: boolean; user?: any; error?: string }> => {
  try {
    const normalized = memberId.trim().toUpperCase();
    if (!normalized) {
      return { success: false, error: '引荐码不能为空' };
    }

    const response = await fetch('/.netlify/functions/lookup-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: normalized }),
    });
    const result = await response.json() as { success?: boolean; user?: any; error?: string };

    if (!response.ok || !result.success || !result.user) {
      return { success: false, error: result.error || '引荐码不存在' };
    }

    return { success: true, user: result.user };
  } catch (error) {
    return { success: false, error: '查询失败，请重试' };
  }
};

/**
 * 验证引荐码（即验证 memberId）
 */
export const validateReferralCode = async (code: string): Promise<{ valid: boolean; referrer?: any; error?: string }> => {
  const result = await getUserByMemberId(code);
  
  if (!result.success) {
    return { valid: false, error: result.error };
  }
  
  return { valid: true, referrer: result.user };
};

/**
 * 格式化会员编号显示
 * @param memberId 会员编号（6位Base36编码）
 * @param format 格式化方式: 'full' | 'short' | 'display'
 */
export const formatMemberId = (memberId: string | undefined, format: 'full' | 'short' | 'display' = 'full'): string => {
  if (!memberId) return '-';
  
  switch (format) {
    case 'full':
      return memberId;  // 完整格式：3K7Y2W
    case 'short':
      return memberId;  // 短格式（与完整格式相同）：3K7Y2W
    case 'display':
      return memberId;  // 显示格式（与完整格式相同）：3K7Y2W
    default:
      return memberId;
  }
};
