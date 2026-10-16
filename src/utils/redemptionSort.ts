import type { RedemptionRecord } from '../types';
import { toDateOrNull } from '../services/firebase/core/sanitize';

type SortableRedemption = Pick<RedemptionRecord, 'status' | 'redeemedAt'>;

export function compareRedemptionsPendingFirst(a: SortableRedemption, b: SortableRedemption): number {
  if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1;
  return (toDateOrNull(b.redeemedAt)?.getTime() ?? 0) - (toDateOrNull(a.redeemedAt)?.getTime() ?? 0);
}
