import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/modules/auth';
import { activateMembership, getMembershipPaymentQuote } from '../services/membershipActivation';
import { getUserData } from '../services/firebase/auth';

export function useAutomaticMembershipRenewal() {
  const { user, loading, setUser } = useAuthStore();
  const attempted = useRef(new Set<string>());
  const points = Number(user?.membership?.points || 0);
  const expiry = user?.membership?.activeUntil?.toString() || '';

  useEffect(() => {
    if (loading || !user?.id || user.status !== 'inactive' || !Number.isFinite(points) || points <= 0) return;
    const userId = user.id;
    const key = `${userId}:${expiry}:${points}`;
    if (attempted.current.has(key)) return;
    let cancelled = false;
    const renew = async () => {
      try {
        const quote = await getMembershipPaymentQuote();
        if (cancelled || !quote.renewal || quote.pending || !Number.isFinite(quote.annualFee)
          || quote.annualFee <= 0 || points < quote.annualFee) return;
        // Do not repeatedly submit a failed debit for an unchanged account balance.
        attempted.current.add(key);
        const result = await activateMembership();
        if (cancelled || (!result.success && result.code !== 'ALREADY_ACTIVE')) return;
        const freshUser = await getUserData(userId);
        if (!cancelled && freshUser) setUser(freshUser);
      } catch {
        // Leave manual renewal available when the backend cannot confirm eligibility.
      }
    };
    void renew();
    return () => { cancelled = true; };
  }, [loading, user?.id, user?.status, points, expiry, setUser]);
}
