import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import OccupancyTrendChart from './OccupancyTrendChart';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
const data = [{ label: '10:00', value: 3, redemptions: 5 }, { label: '11:00', value: 2, redemptions: 0 }];
it('renders both curves and supports independent legend toggles', () => {
  const { container } = render(<OccupancyTrendChart data={data} isMobile={false} />);
  expect(container.querySelectorAll('path[data-series]')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'dashboard.cigarRedemptions' }));
  expect(container.querySelector('path[data-series="redemptions"]')).toBeNull();
  expect(container.querySelector('path[data-series="occupancy"]')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'dashboard.cigarRedemptions' }));
  expect(container.querySelectorAll('path[data-series]')).toHaveLength(2);
});
it('shows exact quantities through keyboard focus and preserves zero', () => {
  render(<OccupancyTrendChart data={data} isMobile />);
  fireEvent.focus(screen.getByRole('button', { name: /11:00:/ }));
  expect(screen.getByRole('status').textContent).toContain('dashboard.cigarRedemptions: 0');
  fireEvent.keyDown(screen.getByRole('button', { name: /11:00:/ }), { key: 'Escape' });
  expect(screen.queryByRole('status')).toBeNull();
});
it('does not draw unavailable redemption data as zero and survives period shortening', () => {
  const { container, rerender } = render(<OccupancyTrendChart data={data} isMobile />);
  fireEvent.focus(screen.getByRole('button', { name: /11:00:/ }));
  rerender(<OccupancyTrendChart data={[{ ...data[0], redemptions: null }]} isMobile />);
  expect(screen.getByText('dashboard.redemptionTrendUnavailable')).toBeTruthy();
  expect(container.querySelector('path[data-series="redemptions"]')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
});
it('shows all seven weekday labels even on mobile', () => {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const { container } = render(<OccupancyTrendChart data={labels.map(label => ({ label, value: 1, redemptions: 2 }))} isMobile />);
  expect([...container.querySelectorAll('svg text')].map(text => text.textContent).filter(text => labels.includes(text!))).toEqual(labels);
});
