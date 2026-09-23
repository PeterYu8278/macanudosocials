/**
 * Whapi.Cloud WhatsApp API 服务
 */
import axios, { AxiosInstance } from 'axios';
import { doc, collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import type { WhapiConfig, SendMessageRequest, SendMessageResponse, MessageRecord, MessageTemplate } from '../../types/whapi';
import { getAppConfig } from '../firebase/appConfig';

// 默认配置
const DEFAULT_BASE_URL = 'https://gate.whapi.cloud';

// 创建 axios 实例
let axiosInstance: AxiosInstance | null = null;

/**
 * 初始化 Whapi 客户端
 */
export const initWhapiClient = async (config?: WhapiConfig): Promise<AxiosInstance | null> => {
  const appConfig = await getAppConfig();
  const whapiConfig = config || appConfig?.whapi;

  if (!whapiConfig?.apiToken || !whapiConfig?.enabled) {
    return null;
  }

  const baseURL = whapiConfig.baseUrl || DEFAULT_BASE_URL;
  const token = whapiConfig.apiToken;

  axiosInstance = axios.create({
    baseURL,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });

  return axiosInstance;
};

/**
 * 获取 Whapi 客户端实例
 */
export const getWhapiClient = async (): Promise<AxiosInstance | null> => {
  if (axiosInstance) {
    return axiosInstance;
  }
  return await initWhapiClient();
};

/**
 * 检查 Whapi 配置和连接状态
 */
export const checkWhapiHealth = async (): Promise<{ success: boolean; error?: string; data?: any }> => {
  try {
    const client = await getWhapiClient();
    if (!client) {
      return { success: false, error: 'Whapi 未配置或未启用' };
    }

    const response = await client.get('/health');
    return { success: true, data: response.data };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || error.message || '连接失败',
    };
  }
};

/**
 * 发送文本消息
 */
export const sendTextMessage = async (
  to: string,
  text: string,
  userId?: string,
  userName?: string
): Promise<SendMessageResponse> => {
  try {
    const client = await getWhapiClient();
    if (!client) {
      return { success: false, error: 'Whapi 未配置或未启用' };
    }

    // 格式化电话号码（确保格式正确）
    const formattedPhone = formatPhoneNumber(to);

    const request: SendMessageRequest = {
      to: formattedPhone,
      type: 'text',
      text,
    };

    // 根据 Whapi.Cloud API 规范，发送文本消息使用 /messages/text 端点
    const response = await client.post('/messages/text', {
      to: formattedPhone,
      body: text,
    });
    const messageId = response.data?.id || response.data?.message_id;

    // 记录消息到 Firestore
    if (userId) {
      const messageRecord: Omit<MessageRecord, 'id' | 'createdAt'> = {
        userId,
        userName,
        phone: formattedPhone,
        type: 'custom',
        message: text,
        status: 'sent',
        createdBy: userId,
      };
      
      // 只有当 messageId 是有效字符串时才添加
      if (messageId && typeof messageId === 'string' && messageId.trim() !== '') {
        messageRecord.messageId = messageId;
      }
      
      await recordMessage(messageRecord);
    }

    return {
      success: true,
      ...(messageId && typeof messageId === 'string' && messageId.trim() !== '' ? { messageId } : {}),
      data: response.data,
    };
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message || '发送失败';

    // 记录失败消息
    if (userId) {
      await recordMessage({
        userId,
        userName,
        phone: to,
        type: 'custom',
        message: text,
        status: 'failed',
        error: errorMessage,
        createdBy: userId,
      });
    }

    return {
      success: false,
      error: errorMessage,
    };
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
    
    return await sendTextMessage(phone, message, userId, userName);
  }

  return await sendTextMessage(phone, template, userId, userName);
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

    return await sendTextMessage(phone, message, userId, userName);
  }

  return await sendTextMessage(phone, template, userId, userName);
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

    return await sendTextMessage(phone, message, userId, userName);
  }

  return await sendTextMessage(phone, template, userId, userName);
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
