import { toDateOrNull } from '../services/firebase/core/sanitize';

type EntryAction = 'active' | 'blocked' | 'join' | 'reload' | 'renew' | 'resume';

interface EntryInput {
  status?: string;
  points?: number;
  activeFrom?: unknown;
  activeUntil?: unknown;
  firstActivatedAt?: unknown;
  annualFee: number | null;
  quote?: { renewal: boolean; pending?: boolean; annualFee: number } | null;
}

export function getMembershipEntryAction(input: EntryInput, now = new Date()): EntryAction {
  if (input.status === 'suspended') return 'blocked';
  const start = toDateOrNull(input.activeFrom);
  const end = toDateOrNull(input.activeUntil);
  if (input.status === 'active' && (!end || end > now)) return 'active';
  if (input.quote?.pending) return 'resume';
  const first = toDateOrNull(input.firstActivatedAt);
  // Local dates are display hints only. A successful server quote overrides them;
  // neither this decision nor a cached first-activation date authorizes a debit.
  const localHistory = Boolean((first && first <= now) || (start && end && start <= now && end > start));
  const hasHistory = input.quote ? input.quote.renewal : localHistory;
  if (!hasHistory) return 'join';
  const fee = input.quote?.annualFee ?? input.annualFee;
  if (fee == null || !Number.isFinite(fee) || fee <= 0 || !Number.isFinite(input.points)) return 'renew';
  return input.points! < fee ? 'reload' : 'renew';
}
