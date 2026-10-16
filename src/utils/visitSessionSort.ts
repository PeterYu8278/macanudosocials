import type { VisitSession } from '../types';
import { toDateOrNull } from '../services/firebase/core/sanitize';

export function sortVisitSessions(sessions: readonly VisitSession[]): VisitSession[] {
  return [...sessions].sort((a, b) => {
    const aCheckedIn = a.status === 'pending' && !a.checkOutAt;
    const bCheckedIn = b.status === 'pending' && !b.checkOutAt;
    if (aCheckedIn !== bCheckedIn) return aCheckedIn ? -1 : 1;
    return (toDateOrNull(b.checkInAt)?.getTime() ?? 0) - (toDateOrNull(a.checkInAt)?.getTime() ?? 0);
  });
}
