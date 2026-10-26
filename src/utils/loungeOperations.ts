export interface LoungeDay { open: boolean; startsAt: string }
export interface LoungeReportDelivery {
  provider: 'whapi' | 'whatsmeow';
  channelId: string;
  recipient: string;
}
export interface LoungeOperations {
  enabled: boolean;
  timezone: 'Asia/Kuala_Lumpur';
  week: LoungeDay[];
  exceptions: Array<{ date: string; open: boolean; startsAt: string }>;
  dailyReportEnabled: boolean;
  whapiChannelId: string;
  reportDelivery?: LoungeReportDelivery;
}

export const emptyLoungeOperations = (): LoungeOperations => ({
  enabled: false, timezone: 'Asia/Kuala_Lumpur',
  week: Array.from({ length: 7 }, () => ({ open: true, startsAt: '10:00' })),
  exceptions: [], dailyReportEnabled: false, whapiChannelId: '',
});

const DAY = 86400000;
export function localBusinessDate(now: Date): string { return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10); }
export function businessDayStart(date: string): Date { return new Date(`${date}T00:00:00+08:00`); }
export function businessCutoff(date: string): Date { return new Date(`${date}T23:00:00+08:00`); }
export function firstVisitCutoff(checkIn: Date): Date {
  const cutoff = businessCutoff(localBusinessDate(checkIn));
  return checkIn < cutoff ? cutoff : new Date(cutoff.getTime() + DAY);
}

export function validateLoungeOperations(value: LoungeOperations): void {
  if (!value || value.timezone !== 'Asia/Kuala_Lumpur' || typeof value.enabled !== 'boolean'
    || typeof value.dailyReportEnabled !== 'boolean' || typeof value.whapiChannelId !== 'string' || value.whapiChannelId.length > 200
    || !Array.isArray(value.week) || value.week.length !== 7 || !Array.isArray(value.exceptions) || value.exceptions.length > 100) throw new Error('invalid-hours');
  const route = value.reportDelivery;
  if (route && (!['whapi', 'whatsmeow'].includes(route.provider)
    || typeof route.channelId !== 'string' || route.channelId.length > 200
    || typeof route.recipient !== 'string'
    || (route.recipient !== '' && !/^\+[1-9]\d{6,14}$/.test(route.recipient))
    || (value.dailyReportEnabled && (!route.channelId.trim() || !route.recipient)))) throw new Error('invalid-hours');
  const validDay = (d: LoungeDay) => d && typeof d.open === 'boolean' && typeof d.startsAt === 'string'
    && (!d.open || /^([01]\d|2[0-2]):[0-5]\d$/.test(d.startsAt));
  if (!value.week.every(validDay) || !value.exceptions.every(d => validDay(d) && /^\d{4}-\d{2}-\d{2}$/.test(d.date)
    && Number.isFinite(businessDayStart(d.date).getTime()) && localBusinessDate(businessDayStart(d.date)) === d.date)
    || new Set(value.exceptions.map(d => d.date)).size !== value.exceptions.length
    || (value.enabled && !value.week.some(d => d.open)) || (value.dailyReportEnabled && !route && !value.whapiChannelId.trim())) throw new Error('invalid-hours');
}

export function loungeAvailability(operations: LoungeOperations | undefined, now = new Date()): { allowed: boolean; nextOpen: string | null } {
  if (!operations?.enabled) return { allowed: true, nextOpen: null };
  validateLoungeOperations(operations);
  const today = localBusinessDate(now);
  for (let offset = 0; offset <= 370; offset++) {
    const date = localBusinessDate(new Date(businessDayStart(today).getTime() + offset * DAY));
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const hours = operations.exceptions.find(item => item.date === date) || operations.week[weekday];
    if (!hours.open) continue;
    const start = new Date(`${date}T${hours.startsAt}:00+08:00`);
    if (offset === 0 && now >= start && now < businessCutoff(date)) return { allowed: true, nextOpen: null };
    if (start > now) return { allowed: false, nextOpen: start.toISOString() };
  }
  return { allowed: false, nextOpen: null };
}

export function visitChargeQuote(session: {
  checkInAt: Date; hourlyRate: number; realtimeDeductionsEnabled?: boolean; realtimePointsDeducted?: number;
  deductionCount?: number; isFirstVisitAfterRenewal?: boolean;
  checkoutPending?: { requestedAt: Date } | null;
  dayPass?: { isPurchased: boolean; config: { cost: number; freeHours: number; hourlyRateAfter: number } };
}, end: Date) {
  const requested = session.checkoutPending?.requestedAt;
  const cutoff = requested && requested < end ? requested : end;
  const minutes = Math.max(0, Math.floor((cutoff.getTime() - session.checkInAt.getTime()) / 60000));
  const hours = minutes / 60;
  const realtime = session.realtimeDeductionsEnabled && !session.dayPass?.isPurchased;
  const intervals = realtime ? Math.max(0, Math.floor((cutoff.getTime() - session.checkInAt.getTime() - 3600000) / 1800000) + 1) : 0;
  const billedHours = realtime ? 1 + intervals * 0.5 : hours;
  const prepaid = session.dayPass?.isPurchased ? session.dayPass.config.cost : realtime ? session.realtimePointsDeducted || 0 : 0;
  const total = session.isFirstVisitAfterRenewal ? 0 : session.dayPass?.isPurchased
    ? prepaid + Math.round(Math.max(0, hours - session.dayPass.config.freeHours) * session.dayPass.config.hourlyRateAfter)
    : realtime ? session.hourlyRate * billedHours : Math.round(session.hourlyRate * hours);
  const alreadyHours = realtime ? (session.deductionCount || 0) > 0 ? 1 + Math.max(0, (session.deductionCount || 1) - 1) * 0.5 : 0 : 0;
  return { cutoff, minutes, hours, billedHours, total, due: total - prepaid,
    hoursAdjustment: session.dayPass?.isPurchased ? 0 : billedHours - alreadyHours, deductionCount: realtime ? 1 + intervals : 0 };
}
