import type { ReloadRecord } from '../types';

export type ReloadDisplayStatus = ReloadRecord['status'] | 'withdrawn';
export type ReloadStatusFilter = ReloadDisplayStatus | 'all';

export function getReloadDisplayStatus(record: Pick<ReloadRecord, 'status' | 'reviewAction'>): ReloadDisplayStatus {
  if (record.status === 'rejected' && record.reviewAction === 'cancel') return 'withdrawn';
  return record.status;
}

// Withdrawals retain the existing persisted status; the audit action distinguishes them.
export function reloadStatusQuery(filter: ReloadStatusFilter): ReloadRecord['status'] | undefined {
  return filter === 'all' ? undefined : filter === 'withdrawn' ? 'rejected' : filter as ReloadRecord['status'];
}
