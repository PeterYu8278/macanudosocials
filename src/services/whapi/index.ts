/**
 * Whapi.Cloud WhatsApp API 服务
 */
import { whatsappRequest } from '../api/whatsapp';
import { doc, collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import type { WhapiConfig, SendMessageRequest, SendMessageResponse, MessageRecord, MessageTemplate } from '../../types/whapi';
import { getAppConfig } from '../firebase/appConfig';

export const checkWhapiHealth = async (): Promise<{ success: boolean; error?: string; data?: any }> => {
  try { return { success: true, data: await whatsappRequest('health') } }
  catch (error) { return { success: false, error: error instanceof Error ? error.message : 'request-failed' } }
};

export const sendTextMessage = async (
  to: string, text: string, userId?: string, _userName?: string,
  kind: 'custom' | 'event_reminder' | 'vip_expiry' | 'password_reset' = 'custom'
): Promise<SendMessageResponse> => {
  try {
    const key = userId ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(JSON.stringify([userId, kind, to, text]))))).map(byte => byte.toString(16).padStart(2, '0')).join('') : crypto.randomUUID();
    const result = await whatsappRequest(userId ? 'send' : 'test', {
      phone: to, text, userId, kind, requestId: key,
    });
    const success = ['accepted', 'sent', 'delivered', 'read'].includes(result.status);
    return { success, messageId: result.messageId || undefined,
      ...(!success ? { error: result.status } : {}) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'request-failed' };
  }
};

/**
 * 发送活动提醒
 */
export const sendEventReminder = async (
  phone: string,
  userName: string,
  eventName: string,
  eventDate: string,
  eventLocation: string,
  userId?: string,
  template?: string
): Promise<SendMessageResponse> => {
  // 如果没有提供模板，使用默认格式
  if (!template) {
    // 获取应用名称
    const appConfig = await getAppConfig();
    const appName = appConfig?.appName || 'MS';
    
    // 解析日期和时间
    let dateStr = '';
    let timeStr = '';
    
    try {
      const dateObj = new Date(eventDate);
      if (!isNaN(dateObj.getTime())) {
        // 格式化日期：YYYY/MM/DD
        const year = dateObj.getFullYear();
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getDate()).padStart(2, '0');
        dateStr = `${year}/${month}/${day}`;
        
        // 格式化时间：HH:mm:ss
        const hours = String(dateObj.getHours()).padStart(2, '0');
        const minutes = String(dateObj.getMinutes()).padStart(2, '0');
        const seconds = String(dateObj.getSeconds()).padStart(2, '0');
        timeStr = `${hours}:${minutes}:${seconds}`;
      } else {
        // 如果无法解析，使用原始字符串
        dateStr = eventDate;
        timeStr = '';
      }
    } catch {
      dateStr = eventDate;
      timeStr = '';
    }

    const message = `[${appName}] 活动温馨提醒：
您好 ${userName}，您已报名"${appName}"的"${eventName}"，期待您的参与!

日期: ${dateStr}${timeStr ? `
时间: ${timeStr}` : ''}
地点: ${eventLocation}`;
    
    return await sendTextMessage(phone, message, userId, userName, 'event_reminder');
  }

  return await sendTextMessage(phone, template, userId, userName, 'event_reminder');
};

/**
 * 发送 VIP 到期提醒
 */
export const sendVipExpiryReminder = async (
  phone: string,
  userName: string,
  expiryDate: string,
  userId?: string,
  template?: string
): Promise<SendMessageResponse> => {
  // 如果没有提供模板，使用默认格式
  if (!template) {
    // 获取应用名称
    const appConfig = await getAppConfig();
    const appName = appConfig?.appName || 'MS';
    
    const message = `[${appName}] VIP到期温馨提醒
您好 ${userName}，您的VIP会员资格将于 ${expiryDate} 到期。
请及时续费以继续享受会员权益。`;

    return await sendTextMessage(phone, message, userId, userName, 'vip_expiry');
  }

  return await sendTextMessage(phone, template, userId, userName, 'vip_expiry');
};

/**
 * 发送重置密码消息
 */
export const sendPasswordReset = async (
  phone: string,
  userName: string,
  resetLinkOrPassword: string, // 可以是重置链接或临时密码
  userId?: string,
  template?: string
): Promise<SendMessageResponse> => {
  // 如果没有提供模板，使用默认格式
  if (!template) {
    // 获取应用名称
    const appConfig = await getAppConfig();
    const appName = appConfig?.appName || 'MS';
    
    // 判断是链接还是密码（链接通常包含 http 或 /reset-password）
    const isLink = resetLinkOrPassword.includes('http') || resetLinkOrPassword.includes('/reset-password');
    
    let message: string;
    if (isLink) {
      // 重置链接格式
      message = `[${appName}] 重置密码
您好 ${userName}，您已申请重置密码。如非本人操作，请忽略此消息。

重置链接：${resetLinkOrPassword} (有效期24小时)`;
    } else {
      // 临时密码格式
      message = `[${appName}] 重置密码
您好 ${userName}，您的密码已重置。

临时密码：${resetLinkOrPassword}

请尽快登录并修改密码。如非本人操作，请立即联系管理员。`;
    }

    return await sendTextMessage(phone, message, userId, userName, 'password_reset');
  }

  return await sendTextMessage(phone, template, userId, userName, 'password_reset');
};

/**
 * 格式化电话号码
 * 将电话号码格式化为 Whapi 要求的格式（国家代码+号码，无+号，无空格）
 */
export const formatPhoneNumber = (phone: string): string => {
  // 移除所有非数字字符
  let cleaned = phone.replace(/\D/g, '');

  // 如果以 0 开头（马来西亚本地格式），替换为 60
  if (cleaned.startsWith('0')) {
    cleaned = '60' + cleaned.substring(1);
  }

  // 如果以 + 开头，移除 +
  if (phone.startsWith('+')) {
    cleaned = phone.replace(/\D/g, '');
  }

  return cleaned;
};

/**
 * 记录消息到 Firestore
 */
export const recordMessage = async (message: Omit<MessageRecord, 'id' | 'createdAt'>): Promise<string | null> => {
  try {
    // 过滤掉所有 undefined 和 null 值，因为 Firestore 不允许存储这些值
    const cleanMessage = Object.fromEntries(
      Object.entries(message).filter(([_, value]) => value !== undefined && value !== null)
    );
    
    const docRef = await addDoc(collection(db, GLOBAL_COLLECTIONS.WHAPI_MESSAGES), {
      ...cleanMessage,
      createdAt: Timestamp.fromDate(new Date()),
    });
    return docRef.id;
  } catch (error) {
    console.error('[recordMessage] 记录消息失败:', error);
    return null;
  }
};

/**
 * 获取消息模板
 */
export const getMessageTemplate = async (type: MessageTemplate['type']): Promise<MessageTemplate | null> => {
  try {
    const appConfig = await getAppConfig();
    const templates = appConfig?.whapiTemplates || [];
    return templates.find(t => t.type === type && t.enabled) || null;
  } catch (error) {
    console.error('[getMessageTemplate] 获取模板失败:', error);
    return null;
  }
};

/**
 * 渲染消息模板（替换变量）
 */
export const renderMessageTemplate = (template: string, variables: Record<string, string>): string => {
  let message = template;
  Object.entries(variables).forEach(([key, value]) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    message = message.replace(regex, value);
  });
  return message;
};
