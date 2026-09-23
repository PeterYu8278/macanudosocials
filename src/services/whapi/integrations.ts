/**
 * Whapi 集成函数
 * 在系统关键流程中自动发送 WhatsApp 消息
 */
import { getUserById } from '../firebase/firestore';
import { getAppConfig } from '../firebase/appConfig';
import { sendEventReminder, sendVipExpiryReminder, sendPasswordReset } from './index';
import type { User, Event } from '../../types';
import { getMessageTemplate, renderMessageTemplate } from './index';

/**
 * 发送活动提醒（在用户报名活动时调用）
 */
export const sendEventReminderToUser = async (
  userId: string,
  event: Event
): Promise<{ success: boolean; error?: string }> => {
  try {
    const user = await getUserById(userId);
    if (!user) {
      return { success: false, error: '用户不存在' };
    }

    const phone = user.profile?.phone || user.phone;
    if (!phone) {
      return { success: false, error: '用户未设置手机号' };
    }

    // 解析活动日期和时间
    const startDate = event.schedule.startDate instanceof Date
      ? event.schedule.startDate
      : new Date(event.schedule.startDate);
    
    const year = startDate.getFullYear();
    const month = String(startDate.getMonth() + 1).padStart(2, '0');
    const day = String(startDate.getDate()).padStart(2, '0');
    const hours = String(startDate.getHours()).padStart(2, '0');
    const minutes = String(startDate.getMinutes()).padStart(2, '0');
    const seconds = String(startDate.getSeconds()).padStart(2, '0');
    
    const dateStr = `${year}/${month}/${day}`;
    const timeStr = `${hours}:${minutes}:${seconds}`;
    const eventDateStr = `${dateStr} ${timeStr}`;

    // 获取应用名称
    const appConfig = await getAppConfig();
    const appName = appConfig?.appName || 'MS';

    // 获取消息模板
    const template = await getMessageTemplate('event_reminder');
    let message: string | undefined;

    if (template) {
      message = renderMessageTemplate(template.template, {
        userName: user.displayName,
        appName,
        eventName: event.title,
        eventDate: dateStr,
        eventTime: timeStr,
        eventLocation: event.location.name || event.location.address,
      });
    } else {
      // 如果没有模板，使用默认格式（sendEventReminder 会处理）
      message = undefined;
    }

    const result = await sendEventReminder(
      phone,
      user.displayName,
      event.title,
      eventDateStr,
      event.location.name || event.location.address,
      userId,
      message
    );

    return result;
  } catch (error: any) {
    return { success: false, error: error.message || '发送失败' };
  }
};

/**
 * 发送 VIP 到期提醒（在年费到期前调用）
 */
export const sendVipExpiryReminderToUser = async (
  userId: string,
  expiryDate: Date
): Promise<{ success: boolean; error?: string }> => {
  try {
    // 检查功能是否启用
    const appConfig = await getAppConfig();
    if (!appConfig?.whapi?.enabled || !appConfig?.whapi?.features?.vipExpiry) {
      return { success: false, error: 'VIP到期提醒功能未启用' };
    }

    const user = await getUserById(userId);
    if (!user) {
      return { success: false, error: '用户不存在' };
    }

    const phone = user.profile?.phone || user.phone;
    if (!phone) {
      return { success: false, error: '用户未设置手机号' };
    }

    // 获取应用名称（appConfig 已在上面获取）
    const appName = appConfig?.appName || 'MS';

    // 获取消息模板
    const template = await getMessageTemplate('vip_expiry');
    let message: string | undefined;

    if (template) {
      message = renderMessageTemplate(template.template, {
        userName: user.displayName,
        appName,
        expiryDate: expiryDate.toLocaleString('zh-CN'),
      });
    } else {
      // 如果没有模板，使用默认格式（sendVipExpiryReminder 会处理）
      message = undefined;
    }

    const result = await sendVipExpiryReminder(
      phone,
      user.displayName,
      expiryDate.toLocaleString('zh-CN'),
      userId,
      message
    );

    return result;
  } catch (error: any) {
    return { success: false, error: error.message || '发送失败' };
  }
};

/**
 * 发送重置密码消息（在用户申请重置密码时调用）
 */
export const sendPasswordResetToUser = async (
  userId: string,
  resetLink: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    // 检查功能是否启用
    const appConfig = await getAppConfig();
    if (!appConfig?.whapi?.enabled || !appConfig?.whapi?.features?.passwordReset) {
      return { success: false, error: '重置密码功能未启用' };
    }

    const user = await getUserById(userId);
    if (!user) {
      return { success: false, error: '用户不存在' };
    }

    const phone = user.profile?.phone || user.phone;
    if (!phone) {
      // 如果没有手机号，静默失败（可能通过邮件发送）
      return { success: false, error: '用户未设置手机号' };
    }

    // 获取应用名称
    const appName = appConfig?.appName || 'MS';

    // 获取消息模板
    const template = await getMessageTemplate('password_reset');
    let message: string | undefined;

    if (template) {
      message = renderMessageTemplate(template.template, {
        userName: user.displayName,
        appName,
        resetLink,
      });
    } else {
      // 如果没有模板，使用默认格式（sendPasswordReset 会处理）
      message = undefined;
    }

    const result = await sendPasswordReset(
      phone,
      user.displayName,
      resetLink,
      userId,
      message
    );

    return result;
  } catch (error: any) {
    return { success: false, error: error.message || '发送失败' };
  }
};
