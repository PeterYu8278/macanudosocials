import { 
  collection, 
  addDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  limit, 
  Timestamp,
  startAt,
  endAt
} from '@/services/firebase/monitoredFirestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import { useAuthStore } from '../../store/modules/auth';
import type { AuditLog, AuditLogModule, AuditLogAction } from '../../types';
import { sanitizeForFirestore } from './core/sanitize';

/**
 * 保存审计日志
 */
export const saveAuditLog = async (params: {
  module: AuditLogModule;
  action: AuditLogAction;
  targetId: string;
  description: string;
  details?: any;
  storeId?: string;
}): Promise<void> => {
  try {
    const { user } = useAuthStore.getState();
    
    // 如果没有用户（如未登录操作），可能需要记录为 'system' 或跳过
    const operatorId = user?.id || 'system';
    const operatorName = user?.displayName || 'System';
    const finalStoreId = params.storeId || user?.storeId || '';

    const logData: Omit<AuditLog, 'id'> = {
      timestamp: new Date(),
      operatorId,
      operatorName,
      module: params.module,
      action: params.action,
      targetId: params.targetId,
      description: params.description,
      details: sanitizeForFirestore(params.details) ?? null,
      storeId: finalStoreId
    };

    await addDoc(collection(db, GLOBAL_COLLECTIONS.AUDIT_LOGS), {
      ...logData,
      timestamp: Timestamp.fromDate(logData.timestamp)
    });
    
    console.log(`[AuditLog] Log saved: ${params.module} - ${params.action}`);
  } catch (error) {
    console.error('[AuditLog] Failed to save log:', error);
    // 审计日志失败不应中断主业务逻辑，所以只打印错误
  }
};

/**
 * 获取审计日志
 */
export const getAuditLogs = async (filters: {
  module?: AuditLogModule;
  action?: AuditLogAction;
  operatorId?: string;
  storeId?: string;
  startDate?: Date;
  endDate?: Date;
  limitCount?: number;
}): Promise<AuditLog[]> => {
  try {
    const logsRef = collection(db, GLOBAL_COLLECTIONS.AUDIT_LOGS);
    let q = query(logsRef, orderBy('timestamp', 'desc'));

    if (filters.module) {
      q = query(q, where('module', '==', filters.module));
    }
    if (filters.action) {
      q = query(q, where('action', '==', filters.action));
    }
    if (filters.operatorId) {
      q = query(q, where('operatorId', '==', filters.operatorId));
    }
    if (filters.storeId) {
      q = query(q, where('storeId', '==', filters.storeId));
    }
    if (filters.startDate) {
      q = query(q, where('timestamp', '>=', Timestamp.fromDate(filters.startDate)));
    }
    if (filters.endDate) {
      q = query(q, where('timestamp', '<=', Timestamp.fromDate(filters.endDate)));
    }
    
    if (filters.limitCount) {
      q = query(q, limit(filters.limitCount));
    } else {
      q = query(q, limit(100)); // 默认取最近100条
    }

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate() || new Date()
      } as AuditLog;
    });
  } catch (error) {
    console.error('[AuditLog] Failed to fetch logs:', error);
    throw error;
  }
};
