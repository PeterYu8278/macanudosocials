import type { Firestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';

export async function readLoungeStatus(db: Firestore, storeId: string) {
  // Preserve the existing index-free sort; fetch related documents in two bulk rounds.
  const batches = await db.collection(C.LOUNGE_BATCHES).where('storeId', '==', storeId).get();
  const rows = batches.docs.map(doc => ({ ...doc.data(), id: doc.id })) as Array<Record<string, any>>;
  rows.sort((a, b) => String(b.businessDate).localeCompare(String(a.businessDate)));
  const recent = rows.slice(0, 14);
  if (!recent.length) return [];
  const reportIds = recent.map(row => `${storeId}_${row.businessDate}_v${row.revision || 1}`);
  // Debt evidence can be large; this view only needs preview text and delivery metadata.
  const reports = await db.getAll(...reportIds.map(id => db.collection(C.LOUNGE_REPORTS).doc(id)),
    { fieldMask: ['text', 'delivery.status', 'delivery.taskId'] });
  const reportById = new Map(reports.map(doc => [doc.id, doc.data()]));
  const taskIds = reportIds.map(id => reportById.get(id)?.delivery?.taskId || `lounge-${id}`);
  const tasks = await db.getAll(...[...new Set(taskIds)].map(id => db.collection(C.WHATSAPP_TASKS).doc(id)), { fieldMask: ['status'] });
  const taskById = new Map(tasks.map(doc => [doc.id, doc.data()]));
  return recent.map((row, index) => {
    const report = reportById.get(reportIds[index]), task = taskById.get(taskIds[index]);
    return { ...row, reportStatus: task?.status || report?.delivery?.status || 'not-sent', reportText: report?.text || '' };
  });
}
