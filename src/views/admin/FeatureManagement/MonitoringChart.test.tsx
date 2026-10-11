import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import MonitoringChart, { dailyMonitoringPoints } from './MonitoringChart';
const row = (date: string, reads = 10) => ({ date, collection: 'users', feature: 'auth', reads, writes: 2, deletes: 1, failures: 0, cacheReads: 4 });
afterEach(cleanup);
describe('monitoring daily chart', () => {
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
