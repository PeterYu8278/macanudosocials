import dayjs from 'dayjs'
import { doc, getDocFromServer, withMonitoringOperation } from './monitoredFirestore'
import { db } from '../../config/firebase'
import { GLOBAL_COLLECTIONS as C } from '../../config/globalCollections'
import { getDashboardRedemptionSummary, type DashboardRedemptionSummary } from './dashboardRedemptionStats'
import { occupancyWeekStart } from '../../utils/occupancyWeek'

export type VisitSummaryStatus = 'ready' | 'initializing' | 'unavailable' | 'timezone'
export interface DashboardVisitSummary {
  status: VisitSummaryStatus
  evaluatedAt: Date | null
  counts: Record<string, number>
  occupancy: { status: VisitSummaryStatus; hours24: number[]; days7: number[]; asOf: Date | null }
  redemptions?: DashboardRedemptionSummary
}
const unavailable = (status: VisitSummaryStatus): DashboardVisitSummary => ({
  status, evaluatedAt: null, counts: {}, occupancy: { status, hours24: [], days7: [], asOf: null },
})
const countValid = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const date = (value: any): Date | null => {
  const result = value?.toDate ? value.toDate() : value instanceof Date ? value : null
  return result && Number.isFinite(result.getTime()) ? result : null
}
export const dashboardVisitScope = (storeId?: string) => {
  if (storeId && (storeId.includes('/') || new TextEncoder().encode(storeId).length > 1000)) throw new Error('INVALID_SUMMARY_STORE_ID')
  return storeId ? `store_${storeId}` : 'all'
}

export function dashboardVisitKeys(now: Date) {
  const time = dayjs(now)
  return [
    ...Array.from({ length: 15 }, (_, i) => `daily_${time.subtract(14 - i, 'day').format('YYYY-MM-DD')}`),
    ...Array.from({ length: 12 }, (_, i) => `monthly_${time.subtract(11 - i, 'month').format('YYYY-MM')}`),
    ...Array.from({ length: 5 }, (_, i) => `yearly_${time.year() - 4 + i}`),
  ]
}

// UTC+08 summaries preserve the previous browser-local calendar semantics only
// when all displayed boundaries match. Other timezones must not receive shifted counts.
export function dashboardTimezoneSupported(now: Date) {
  const time = dayjs(now)
  const boundaries = [now, ...Array.from({ length: 15 }, (_, i) => time.subtract(i, 'day').startOf('day').toDate()),
    ...Array.from({ length: 12 }, (_, i) => time.subtract(i, 'month').startOf('month').toDate()),
    ...Array.from({ length: 5 }, (_, i) => time.subtract(i, 'year').startOf('year').toDate())]
  return boundaries.every(boundary => boundary.getTimezoneOffset() === -480)
}

export async function getDashboardVisitSummary(storeId?: string, now = new Date()): Promise<DashboardVisitSummary> {
  if (!dashboardTimezoneSupported(now)) return unavailable('timezone')
  const read = (...path: string[]) => getDocFromServer(withMonitoringOperation(doc(db, path[0], ...path.slice(1)), 'dashboard.summary'))
  const metadata = (await read(C.DASHBOARD_VISIT_STATS_META, 'default')).data()
  if (!metadata?.ready) return unavailable('initializing')
  if (metadata.version !== 1 || metadata.offsetMinutes !== 480 || !countValid(metadata.revision)) return unavailable('unavailable')
  const scope = dashboardVisitScope(storeId)
  const keys = dashboardVisitKeys(now)
  const [snapshot, ...buckets] = await Promise.all([
    read(C.DASHBOARD_VISIT_STATS, scope),
    ...keys.map(key => read(C.DASHBOARD_VISIT_STATS, scope, 'buckets', key)),
  ])
  const finalMetadata = (await read(C.DASHBOARD_VISIT_STATS_META, 'default')).data()
  if (!finalMetadata?.ready) return unavailable('initializing')
  if (finalMetadata.version !== metadata.version || finalMetadata.runId !== metadata.runId
    || finalMetadata.revision !== metadata.revision) return unavailable('unavailable')
  const counts: Record<string, number> = {}
  for (let index = 0; index < keys.length; index++) {
    const data = buckets[index].data()
    if (data && (data.version !== 1 || !countValid(data.count))) return unavailable('unavailable')
    // A missing bucket means zero only after the full-history bootstrap completed.
    counts[keys[index]] = data?.count ?? 0
  }
  const result: DashboardVisitSummary = { status: 'ready', evaluatedAt: now, counts,
    occupancy: { status: 'unavailable', hours24: [], days7: [], asOf: null } }
  result.redemptions = await getDashboardRedemptionSummary(scope, now)
  const manifest = metadata.occupancy
  const checkedAt = date(metadata.workerCheckedAt)
  const window = dayjs(now).startOf('hour').valueOf()
  const weekStart = occupancyWeekStart(now)
  if (!manifest?.ready || manifest.revision !== metadata.revision || manifest.window !== window || manifest.weekStart !== weekStart
    || !checkedAt || now.getTime() - checkedAt.getTime() > 5 * 60000
    || checkedAt.getTime() > now.getTime() + 60000 || !Array.isArray(manifest.scopes)) return result
  if (!manifest.scopes.includes(scope)) {
    result.occupancy = { status: 'ready', hours24: Array(24).fill(0), days7: Array(7).fill(0), asOf: checkedAt }
    return result
  }
  const data = snapshot.data()
  if (!data || data.version !== 1 || data.revision !== metadata.revision || data.window !== window || data.weekStart !== weekStart
    || !Array.isArray(data.hours24) || data.hours24.length !== 24 || !data.hours24.every(countValid)
    || !Array.isArray(data.days7) || data.days7.length !== 7 || !data.days7.every(countValid)
    || !date(data.asOf)) return result
  result.occupancy = { status: 'ready', hours24: data.hours24, days7: data.days7, asOf: date(data.asOf) }
  return result
}
