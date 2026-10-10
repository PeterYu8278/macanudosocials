// 定时任务函数（可在客户端调用或后端 Cloud Functions 使用）
import { doc, getDoc } from '@/services/firebase/monitoredFirestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import { getExpiredVisitSessions, completeVisitSession } from './visitSessions';
import { getPendingMembershipFeeRecords, deductMembershipFee } from './membershipFee';

/**
 * 处理忘记 check-out 的驻店记录（自动结算）
 * 应在每日凌晨执行
 */
export const processExpiredVisitSessions = async (): Promise<{
  success: boolean;
  processed: number;
  errors: string[];
}> => {
  try {
    const expiredSessions = await getExpiredVisitSessions();
    const errors: string[] = [];
    let processed = 0;

    for (const session of expiredSessions) {
      try {
        // 按5小时强制结算
        const result = await completeVisitSession(session.id, 'system', undefined, 5);
        if (result.success) {
          processed++;
        } else {
          errors.push(`Session ${session.id}: ${result.error || '处理失败'}`);
        }
      } catch (error: any) {
        errors.push(`Session ${session.id}: ${error.message || '处理异常'}`);
      }
    }

    return { success: true, processed, errors };
  } catch (error: any) {
    return { success: false, processed: 0, errors: [error.message || '处理失败'] };
  }
};

/**
 * 处理待扣费的年费记录
 * 应在每日凌晨执行
 */
export const processPendingMembershipFees = async (): Promise<{
  success: boolean;
  processed: number;
  paid: number;
  failed: number;
  errors: string[];
}> => {
  try {
    const today = new Date();
    const pendingRecords = await getPendingMembershipFeeRecords(today);
    const errors: string[] = [];
    let processed = 0;
    let paid = 0;
    let failed = 0;

    for (const record of pendingRecords) {
      try {
        // 在扣费前发送 VIP 到期提醒（异步，不阻塞主流程）
        try {
          const { sendVipExpiryReminderToUser } = await import('../whapi/integrations');
          sendVipExpiryReminderToUser(record.userId, record.dueDate).catch(error => {
            console.warn(`[processPendingMembershipFees] 发送VIP到期提醒失败 (用户 ${record.userId}):`, error);
          });
        } catch (whapiError) {
          // 静默失败，不影响主流程
          console.warn(`[processPendingMembershipFees] Whapi 集成失败 (用户 ${record.userId}):`, whapiError);
        }

        const result = await deductMembershipFee(record.id);
        if (result.success) {
          processed++;
          // 检查记录状态以确定是否成功扣费
          const recordDoc = await getDoc(doc(db, GLOBAL_COLLECTIONS.MEMBERSHIP_FEE_RECORDS, record.id));
          if (recordDoc.exists()) {
            const data = recordDoc.data();
            if (data.status === 'paid') {
              paid++;
            } else if (data.status === 'failed') {
              failed++;
            }
          }
        } else {
          errors.push(`Record ${record.id}: ${result.error || '处理失败'}`);
          failed++;
        }
      } catch (error: any) {
        errors.push(`Record ${record.id}: ${error.message || '处理异常'}`);
        failed++;
      }
    }

    return { success: true, processed, paid, failed, errors };
  } catch (error: any) {
    return { success: false, processed: 0, paid: 0, failed: 0, errors: [error.message || '处理失败'] };
  }
};

/**
 * 执行所有定时任务（组合函数）
 */
export const runAllScheduledJobs = async (): Promise<{
  visitSessions: { success: boolean; processed: number; errors: string[] };
  membershipFees: { success: boolean; processed: number; paid: number; failed: number; errors: string[] };
}> => {
  const visitSessions = await processExpiredVisitSessions();
  const membershipFees = await processPendingMembershipFees();

  return {
    visitSessions,
    membershipFees
  };
};
