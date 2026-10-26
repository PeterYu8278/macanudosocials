// 积分记录服务
import { collection, addDoc, getDocs, query, orderBy, limit, where, Timestamp } from '@/services/firebase/monitoredFirestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS } from '../../config/globalCollections';
import type { PointsRecord } from '../../types';
import { saveAuditLog } from './auditLog';
import { consolidateVisitPointsRecords, isVisitSessionPointsRecord } from '../../utils/pointsRecordDisplay';

// The latest-N list can cut through a session. Complete each visible session before showing its net amount.
async function completeVisibleVisitGroups(records: PointsRecord[]) {
  const groups = new Map(records.filter(record => record.relatedId && isVisitSessionPointsRecord(record))
    .map(record => [`${record.userId}:${record.relatedId}`, record]));
  const merged = new Map(records.map(record => [record.id, record]));
  const complete = new Set<string>();
  const groupsToRead = [...groups.entries()];
  for (let offset = 0; offset < groupsToRead.length; offset += 4) {
    await Promise.all(groupsToRead.slice(offset, offset + 4).map(async ([key, record]) => {
      try {
        // Equality filters avoid imposing a new ordered composite-index requirement.
        const result = await getDocs(query(collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS),
          where('userId', '==', record.userId), where('relatedId', '==', record.relatedId), limit(1001)));
        if (result.size > 1000) return;
        const returnedIds = new Set(result.docs.map(item => item.id));
        if (records.some(item => item.userId === record.userId && item.relatedId === record.relatedId
          && isVisitSessionPointsRecord(item) && !returnedIds.has(item.id))) return;
        for (const item of result.docs) {
          const value = item.data();
          if (!isVisitSessionPointsRecord(value as PointsRecord)) continue;
          merged.set(item.id, { id: item.id, ...value, createdAt: value.createdAt?.toDate?.() || new Date(value.createdAt) } as PointsRecord);
        }
        complete.add(key);
      } catch { /* Show partial evidence explicitly; never present a partial sum as final. */ }
    }));
  }
  const ordered = [...merged.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { records: ordered, complete };
}

const getPendingVisitSessionIds = async (userId?: string): Promise<Set<string>> => {
  try {
    const pendingSessionsQuery = userId
      ? query(
          collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
          where('userId', '==', userId),
          where('status', '==', 'pending')
        )
      : query(
          collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
          where('status', '==', 'pending')
        );
    const snapshot = await getDocs(pendingSessionsQuery);
    return new Set(snapshot.docs.map(session => session.id));
  } catch (error) {
    console.warn('[getUserPointsRecords] Failed to resolve pending visit sessions:', error);
    return new Set();
  }
};

const addPendingVisitSummaries = async (
  userId: string,
  records: PointsRecord[]
): Promise<PointsRecord[]> => {
  try {
    const sessionsSnapshot = await getDocs(query(
      collection(db, GLOBAL_COLLECTIONS.VISIT_SESSIONS),
      where('userId', '==', userId),
      where('status', '==', 'pending')
    ));
    const recordedSessionIds = new Set(
      records
        .filter(record => record.source === 'visit' && record.type === 'spend' && record.relatedId)
        .map(record => record.relatedId as string)
    );
    const summaries = sessionsSnapshot.docs.flatMap(sessionDoc => {
      if (recordedSessionIds.has(sessionDoc.id)) return [];

      const data = sessionDoc.data();
      const amount = Number(data.realtimePointsDeducted || 0);
      if (amount <= 0) return [];

      const deductionCount = Math.max(1, Number(data.deductionCount || 1));
      const billedHours = 1 + Math.max(0, deductionCount - 1) * 0.5;
      return [{
        id: `pending-visit-${sessionDoc.id}`,
        userId,
        userName: data.userName,
        type: 'spend' as const,
        amount,
        source: 'visit' as const,
        description: `驻店计时扣费 (${billedHours}小时，共${amount}积分)`,
        relatedId: sessionDoc.id,
        balance: undefined,
        createdAt: data.checkInAt?.toDate?.() || new Date(data.checkInAt),
        createdBy: data.checkInBy || 'system'
      } satisfies PointsRecord];
    });

    return [...records, ...summaries].sort((a, b) => {
      const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
      const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
      return dateB.getTime() - dateA.getTime();
    });
  } catch (error) {
    console.warn('[getUserPointsRecords] Failed to add pending visit summaries:', error);
    return records;
  }
};

/**
 * 获取所有积分记录
 */
export const getAllPointsRecords = async (limitCount: number = 100): Promise<PointsRecord[]> => {
  try {
    const recordsRef = collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS);
    const q = query(recordsRef, orderBy('createdAt', 'desc'), limit(limitCount));
    const snapshot = await getDocs(q);
    
    const records = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt)
      } as PointsRecord;
    });

    const pendingSessionIds = await getPendingVisitSessionIds();
    const hydrated = await completeVisibleVisitGroups(records);
    return consolidateVisitPointsRecords(hydrated.records, pendingSessionIds, hydrated.complete).slice(0, limitCount);
  } catch (error) {
    return [];
  }
};

/**
 * 获取指定用户的积分记录
 */
export const getUserPointsRecords = async (userId: string, limitCount: number = 50): Promise<PointsRecord[]> => {
  try {
    const recordsRef = collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS);
    const q = query(
      recordsRef,
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    );
    const snapshot = await getDocs(q);
    
    const records = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt)
      } as PointsRecord;
    });
    
    const pendingSessionIds = await getPendingVisitSessionIds(userId);
    const hydrated = await completeVisibleVisitGroups(records);
    const consolidatedRecords = consolidateVisitPointsRecords(hydrated.records, pendingSessionIds, hydrated.complete);
    return (await addPendingVisitSummaries(userId, consolidatedRecords)).slice(0, limitCount);
  } catch (error: any) {
    
    // 如果是索引错误，尝试降级查询（不使用 orderBy）
    if (error?.code === 'failed-precondition') {
      
      try {
        const recordsRef = collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS);
        const fallbackQ = query(
          recordsRef,
          where('userId', '==', userId),
          limit(limitCount * 2) // 获取更多记录以便后续排序
        );
        const snapshot = await getDocs(fallbackQ);
        
        const records = snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt)
          } as PointsRecord;
        });
        
        // 在内存中排序
        records.sort((a, b) => {
          const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt);
          const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt);
          return dateB.getTime() - dateA.getTime();
        });
        
        // 限制返回数量
        const pendingSessionIds = await getPendingVisitSessionIds(userId);
        const hydrated = await completeVisibleVisitGroups(records);
        const consolidatedRecords = consolidateVisitPointsRecords(hydrated.records, pendingSessionIds, hydrated.complete);
        const limitedRecords = (await addPendingVisitSummaries(userId, consolidatedRecords)).slice(0, limitCount);
        return limitedRecords;
      } catch (fallbackError) {
        throw fallbackError;
      }
    }
    
    throw error; // 抛出错误，让调用者处理
  }
};

/**
 * 创建积分记录
 */
export const createPointsRecord = async (
  record: Omit<PointsRecord, 'id' | 'createdAt'>
): Promise<PointsRecord | null> => {
  try {
    const now = new Date();
    const recordData = {
      ...record,
      createdAt: Timestamp.fromDate(now)
    };

    const docRef = await addDoc(collection(db, GLOBAL_COLLECTIONS.POINTS_RECORDS), recordData);
    
    // 记录审计日志
    await saveAuditLog({
      module: 'transactions',
      action: 'create',
      targetId: docRef.id,
      description: `创建积分变动记录: ${record.userName} [${record.type === 'spend' ? '消费' : '增加'}] ${record.amount} 点 (来源: ${record.source})`,
      details: record
    });

    return {
      id: docRef.id,
      ...record,
      createdAt: now
    };
  } catch (error) {
    console.error('Failed to create points record:', error);
    return null;
  }
};
