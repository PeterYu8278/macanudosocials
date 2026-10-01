import { describe, expect, it } from 'vitest';
import type { RedemptionRecord, ReloadRecord, User, VisitSession } from '../types';
import { aggregateMemberReportMetrics } from './memberReport';

const users = [
  { id: 'member-1', displayName: 'Member 1', email: 'one@example.com' },
  {
    id: 'member-2',
    displayName: 'Member 2',
    email: 'two@example.com',
    referral: { referredByUserId: 'member-1' },
  },
] as User[];

describe('aggregateMemberReportMetrics', () => {
  it('aggregates completed reloads, settled visits, cigars and unique referrals', () => {
    const reloads = [
      { userId: 'member-1', status: 'completed', requestedAmount: 300, pointsEquivalent: 300 },
      { userId: 'member-1', status: 'pending', requestedAmount: 200, pointsEquivalent: 200 },
    ] as ReloadRecord[];
    const sessions = [
      { id: 'visit-1', userId: 'member-1', status: 'completed', durationMinutes: 90, checkInType: 'membership' },
      { id: 'visit-2', userId: 'member-1', status: 'expired', durationMinutes: 30, checkInType: 'daypass' },
      { id: 'visit-3', userId: 'member-1', status: 'pending', durationMinutes: 120, checkInType: 'membership' },
    ] as VisitSession[];
    const redemptions = [
      { userId: 'member-1', status: 'completed', cigarId: 'cigar-1', quantity: 2, type: 'mystery_gift' },
      { userId: 'member-1', status: 'pending', cigarId: 'cigar-2', quantity: 3, type: 'mystery_gift' },
      { userId: 'member-1', status: 'completed', cigarId: 'referral_reward', quantity: 1, type: 'referral_reward' },
    ] as RedemptionRecord[];

    const metrics = aggregateMemberReportMetrics(users, reloads, sessions, redemptions).get('member-1');

    expect(metrics).toEqual({
      totalReloadAmount: 300,
      totalReloadPoints: 300,
      visitCount: 2,
      totalVisitHours: 2,
      totalRedeemedCigars: 2,
      totalReferrals: 1,
    });
  });
});
