import { doc, getDocFromServer, withMonitoringOperation } from './monitoredFirestore';
import { db } from '../../config/firebase';
import { GLOBAL_COLLECTIONS as C } from '../../config/globalCollections';
import { occupancyWeekDates } from '../../utils/occupancyWeek';

export interface DashboardRedemptionSummary {
  status: 'ready' | 'initializing' | 'unavailable';
  hours24: number[];
  days7: number[];
}
export function dashboardRedemptionKeys(now: Date) {
  const hour = Math.floor(now.getTime() / 3600000) * 3600000;
  return {
    hours24: Array.from({ length: 24 }, (_, i) => `hour_${new Date(hour - (23 - i) * 3600000).toISOString().slice(0, 13)}`),
    days7: occupancyWeekDates(now).map(date => `day_${new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10)}`),
  };
}
export async function getDashboardRedemptionSummary(scope: string, now: Date): Promise<DashboardRedemptionSummary> {
  const unavailable = (status: DashboardRedemptionSummary['status']): DashboardRedemptionSummary => ({ status, hours24: [], days7: [] });
  const read = (...path: string[]) => getDocFromServer(withMonitoringOperation(doc(db, path[0], ...path.slice(1)), 'dashboard.summary'));
  try {
    const gate = (await read(C.DASHBOARD_REDEMPTION_STATS_META, 'default')).data();
    if (!gate?.ready) return unavailable('initializing');
    if (gate.version !== 1 || !Number.isSafeInteger(gate.revision) || gate.revision < 0) return unavailable('unavailable');
    const keys = dashboardRedemptionKeys(now);
    const snapshots = await Promise.all([...keys.hours24, ...keys.days7].map(key =>
      read(C.DASHBOARD_REDEMPTION_STATS, scope, 'buckets', key)));
    const confirmed = (await read(C.DASHBOARD_REDEMPTION_STATS_META, 'default')).data();
    if (!confirmed?.ready || confirmed.runId !== gate.runId || confirmed.revision !== gate.revision || confirmed.version !== 1) return unavailable('unavailable');
    const values = snapshots.map(snapshot => {
      const data = snapshot.data();
      if (!data) return 0;
      if (data.version !== 1 || !Number.isSafeInteger(data.count) || data.count < 0) throw new Error('INVALID_REDEMPTION_SUMMARY');
      return data.count as number;
    });
    return { status: 'ready', hours24: values.slice(0, 24),
      days7: values.slice(24).map((value, index) => occupancyWeekDates(now)[index].getTime() > now.getTime() ? 0 : value) };
  } catch { return unavailable('unavailable'); }
}
