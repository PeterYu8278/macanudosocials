import { describe, expect, it } from 'vitest';
import { occupancyWeekDates, occupancyWeekStart } from './occupancyWeek';

describe('Monday-Sunday lounge calendar', () => {
  it.each([
    ['2026-10-18T16:00:00Z', '2026-10-19', '2026-10-25'],
    ['2026-10-21T02:00:00Z', '2026-10-19', '2026-10-25'],
    ['2026-10-18T15:59:59Z', '2026-10-12', '2026-10-18'],
    ['2027-01-01T00:00:00Z', '2026-12-28', '2027-01-03'],
  ])('keeps chronological weekday order for %s', (timestamp, monday, sunday) => {
    const now = new Date(timestamp), days = occupancyWeekDates(now);
    const localDate = (date: Date) => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
    expect(days.map(date => new Date(date.getTime() + 8 * 3600000).getUTCDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(localDate(days[0])).toBe(monday); expect(localDate(days[6])).toBe(sunday);
    expect(days[0].getTime()).toBe(occupancyWeekStart(now));
    expect(days[6].getTime() - days[0].getTime()).toBe(6 * 86400000);
  });
});
