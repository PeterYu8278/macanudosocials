import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { useCallback, useEffect, useState } from 'react';

import { db } from '@/lib/firebase';

interface VisitSessionData {
  id: string;
  checkInAt: Date;
  durationHours?: number;
  status?: string;
  checkInType?: string;
}

export interface HomeData {
  currentSession: VisitSessionData | null;
  lastCheckIn: Date | null;
  totalHours: number;
  dailyCount: number;
  totalCount: number;
  dailyLimit: number;
  totalLimit: number;
  referrals: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

function asDate(value: unknown): Date | null {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate() as Date;
  }
  const parsed = value ? new Date(value as string | number) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export function useHomeData(userId?: string): HomeData {
  const [currentSession, setCurrentSession] = useState<VisitSessionData | null>(null);
  const [lastCheckIn, setLastCheckIn] = useState<Date | null>(null);
  const [totalHours, setTotalHours] = useState(0);
  const [dailyCount, setDailyCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [dailyLimit, setDailyLimit] = useState(3);
  const [totalLimit, setTotalLimit] = useState(25);
  const [referrals, setReferrals] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const [sessionSnapshot, redemptionSnapshot, configSnapshot, referralSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'visitSessions'), where('userId', '==', userId), limit(200))),
        getDocs(query(collection(db, 'redemptionRecords'), where('userId', '==', userId), limit(500))),
        getDoc(doc(db, 'redemptionConfig', 'default')),
        getCountFromServer(query(collection(db, 'users', userId, 'referrals'), where('membershipActivatedAt', '!=', null))),
      ]);

      const sessions = sessionSnapshot.docs
        .map((snapshot) => {
          const data = snapshot.data();
          const checkInAt = asDate(data.checkInAt);
          return checkInAt ? {
            id: snapshot.id,
            checkInAt,
            durationHours: Number(data.durationHours || 0),
            status: data.status,
            checkInType: data.checkInType,
          } : null;
        })
        .filter((item): item is VisitSessionData => item !== null)
        .sort((a, b) => b.checkInAt.getTime() - a.checkInAt.getTime());

      setCurrentSession(sessions.find((item) => item.status === 'pending') ?? null);
      setLastCheckIn(sessions[0]?.checkInAt ?? null);
      setTotalHours(sessions
        .filter((item) => item.status === 'completed' && item.checkInType !== 'daypass')
        .reduce((sum, item) => sum + (item.durationHours || 0), 0));

      const today = new Date().toISOString().slice(0, 10);
      let nextDailyCount = 0;
      let nextTotalCount = 0;
      redemptionSnapshot.docs.forEach((snapshot) => {
        const redemptions = Array.isArray(snapshot.data().redemptions) ? snapshot.data().redemptions : [];
        redemptions.forEach((item: Record<string, unknown>) => {
          const quantity = Number(item.quantity || 0);
          if (item.dayKey === today) nextDailyCount += quantity;
          if (!item.isDayPass) nextTotalCount += quantity;
        });
      });
      setDailyCount(nextDailyCount);
      setTotalCount(nextTotalCount);

      if (configSnapshot.exists()) {
        setDailyLimit(Number(configSnapshot.data().dailyLimit || 3));
        setTotalLimit(Number(configSnapshot.data().totalLimit || 25));
      }
      setReferrals(referralSnapshot.data().count);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(interval);
  }, [refresh, userId]);

  return { currentSession, lastCheckIn, totalHours, dailyCount, totalCount, dailyLimit, totalLimit, referrals, loading, refresh };
}
