import { toDateOrNull } from '../services/firebase/core/sanitize';

type EntryAction = 'active' | 'blocked' | 'checking' | 'verify' | 'join' | 'reload' | 'renew' | 'resume';

interface EntryInput {
  status?: string;
  points?: number;
  activeFrom?: unknown;
  activeUntil?: unknown;
  annualFee: number | null;
  quote?: { renewal: boolean; pending?: boolean; annualFee: number } | null;
  queryFailed?: boolean;
}

export function getMembershipEntryAction(input: EntryInput, now = new Date()): EntryAction {
  if (input.status === 'suspended') return 'blocked';
  const start = toDateOrNull(input.activeFrom);
  const end = toDateOrNull(input.activeUntil);
  if (input.status === 'active') return end && end <= now ? 'verify' : 'active';
  if (input.quote?.pending) return 'resume';
  if (end && end > now) return 'verify';
  const hasHistory = Boolean(start || end);
  if (!hasHistory && !input.quote) return input.queryFailed ? 'verify' : 'checking';
  if (!hasHistory && !input.quote?.renewal) return 'join';
  const fee = input.annualFee ?? input.quote?.annualFee;
  if (fee == null || !Number.isFinite(fee) || fee <= 0 || !Number.isFinite(input.points)) return 'checking';
  return input.points! < fee ? 'reload' : 'renew';
}
