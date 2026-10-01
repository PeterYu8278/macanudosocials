import type { RedemptionRecord, ReloadRecord, User, VisitSession } from '../types';

export interface MemberReportMetrics {
  totalReloadAmount: number;
  totalReloadPoints: number;
  visitCount: number;
  totalVisitHours: number;
  totalRedeemedCigars: number;
  totalReferrals: number;
}

const createEmptyMetrics = (): MemberReportMetrics => ({
  totalReloadAmount: 0,
  totalReloadPoints: 0,
  visitCount: 0,
  totalVisitHours: 0,
  totalRedeemedCigars: 0,
  totalReferrals: 0,
});

export const aggregateMemberReportMetrics = (
  users: User[],
  reloads: ReloadRecord[],
  sessions: VisitSession[],
  redemptions: RedemptionRecord[]
): Map<string, MemberReportMetrics> => {
  const metricsByUser = new Map(users.map(user => [user.id, createEmptyMetrics()]));
  const getMetrics = (userId: string) => metricsByUser.get(userId);

  reloads.forEach(reload => {
    if (reload.status !== 'completed') return;
    const metrics = getMetrics(reload.userId);
    if (!metrics) return;
    metrics.totalReloadAmount += Number(reload.requestedAmount || 0);
    metrics.totalReloadPoints += Number(reload.pointsEquivalent || 0);
  });

  sessions.forEach(session => {
    if (session.status !== 'completed' && session.status !== 'expired') return;
    const metrics = getMetrics(session.userId);
    if (!metrics) return;

    const durationMinutes = Number(session.durationMinutes);
    const visitHours = Number.isFinite(durationMinutes) && durationMinutes >= 0
      ? durationMinutes / 60
      : Number(session.durationHours || 0);

    metrics.visitCount += 1;
    metrics.totalVisitHours += Math.max(0, visitHours);
  });

  redemptions.forEach(redemption => {
    if (redemption.status !== 'completed') return;
    if (redemption.type === 'referral_reward') return;
    if (!redemption.cigarId || redemption.cigarId === 'referral_reward') return;

    const metrics = getMetrics(redemption.userId);
    if (!metrics) return;
    metrics.totalRedeemedCigars += Math.max(0, Number(redemption.quantity || 0));
  });

  const referredUserIds = new Map<string, Set<string>>();
  users.forEach(referredUser => {
    const referrerId = referredUser.referral?.referredByUserId;
    if (!referrerId || !metricsByUser.has(referrerId)) return;
    const referrals = referredUserIds.get(referrerId) || new Set<string>();
    referrals.add(referredUser.id);
    referredUserIds.set(referrerId, referrals);
  });

  referredUserIds.forEach((referrals, userId) => {
    const metrics = getMetrics(userId);
    if (metrics) metrics.totalReferrals = referrals.size;
  });

  return metricsByUser;
};
