const DAY = 86400000;
const OFFSET = 8 * 3600000;

/** Calendar week in the lounge timezone, independent of browser locale/week start. */
export function occupancyWeekStart(now: Date): number {
  const day = Math.floor((now.getTime() + OFFSET) / DAY) * DAY - OFFSET;
  const weekday = new Date(day + OFFSET).getUTCDay();
  return day - ((weekday + 6) % 7) * DAY;
}

export function occupancyWeekDates(now: Date): Date[] {
  const monday = occupancyWeekStart(now);
  return Array.from({ length: 7 }, (_, index) => new Date(monday + index * DAY));
}
