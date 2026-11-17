import type { ReloadRecord } from '../types';

// Unmarked records used gross points; never subtract a fee from a net record twice.
export function netReloadPoints(record: Pick<ReloadRecord, 'pointsEquivalent' | 'pointsEquivalentBasis' | 'annualFeeAmount'>): number {
  return Math.round((record.pointsEquivalent - (record.pointsEquivalentBasis === 'net' ? 0 : record.annualFeeAmount || 0)) * 100) / 100;
}

export function netReloadPointsMigration(record: Record<string, unknown>) {
  if (record.pointsEquivalentBasis === 'net' || record.status !== 'completed') return null;
  const gross = record.pointsEquivalent;
  if (typeof gross !== 'number' || !Number.isFinite(gross)) return null;
  // Missing fee evidence on annual payments is not proof of a zero fee.
  if ((record.membershipOrderId || record.paymentPurpose) && typeof record.annualFeeAmount !== 'number') return null;
  const fee = record.annualFeeAmount ?? 0;
  if (typeof fee !== 'number' || !Number.isFinite(fee) || fee < 0) return null;
  return { pointsEquivalent: Math.round((gross - fee) * 100) / 100,
    pointsEquivalentBasis: 'net' as const, legacyGrossPointsEquivalent: gross };
}
