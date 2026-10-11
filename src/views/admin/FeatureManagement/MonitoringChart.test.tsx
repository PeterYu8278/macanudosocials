import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import MonitoringChart, { dailyMonitoringPoints, hourlyMonitoringPoints } from './MonitoringChart';
const row = (date: string, reads = 10) => ({ date, collection: 'users', feature: 'auth', reads, writes: 2, deletes: 1, failures: 0, cacheReads: 4 });
afterEach(cleanup);
describe('monitoring daily chart', () => {
  it('aggregates real hourly buckets across UTC midnight, never distributing daily totals', () => {
    const points = hourlyMonitoringPoints([
      { ...row('2026-10-10'), hour: '2026-10-10T23' },
      { ...row('2026-10-10', 20), hour: '2026-10-10T23' },
      { ...row('2026-10-11', 5), hour: '2026-10-11T00' },
      row('2026-10-11', 999),
    ], 2, new Date('2026-10-11T01:00:00Z'));
    expect(points).toHaveLength(26);
    expect(points[22].values).toBeNull();
    expect(points[23]).toMatchObject({ date: '2026-10-10T23', values: { reads: 30 } });
    expect(points[24]).toMatchObject({ date: '2026-10-11T00', values: { reads: 5 } });
    expect(points[25].values).toBeNull();
  });
  it('changes the axis and empty state in hourly mode', () => {
    const now = new Date().toISOString();
    const { rerender } = render(<MonitoringChart rows={[{ ...row(now.slice(0, 10)), hour: now.slice(0, 13) }]} days={1} loading={false} granularity="hour" />);
    expect(screen.getByRole('img', { name: 'systemMonitoring.hourlyOperations' })).toBeTruthy();
    rerender(<MonitoringChart rows={[]} days={1} loading={false} granularity="hour" />);
    expect(screen.getByText('systemMonitoring.hourlyEmpty')).toBeTruthy();
  });
  it('aggregates collections without counting cached reads or inventing missing observations', () => {
    const result = dailyMonitoringPoints([row('2026-10-10'), row('2026-10-10', 20)], 3, new Date('2026-10-11T23:00:00Z'));
    expect(result).toEqual([
      { date: '2026-10-09', values: null },
      { date: '2026-10-10', values: { reads: 30, writes: 4, deletes: 2 } },
      { date: '2026-10-11', values: null },
    ]);
  });
  it('renders three independently toggleable series', () => {
    const today = new Date().toISOString().slice(0, 10);
    const { container } = render(<MonitoringChart rows={[row(today)]} days={1} loading={false} />);
    expect(container.querySelectorAll('svg path')).toHaveLength(3);
    fireEvent.click(screen.getByRole('checkbox', { name: 'systemMonitoring.reads' }));
    expect(container.querySelectorAll('svg path')).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'systemMonitoring.dailyOperations' })).toBeTruthy();
  });
  it('shows an empty state without a fabricated zero curve', () => {
    const { container } = render(<MonitoringChart rows={[]} days={7} loading={false} />);
    expect(screen.getByText('systemMonitoring.empty')).toBeTruthy();
    expect(container.querySelector('svg[role="img"]')).toBeNull();
  });
});
