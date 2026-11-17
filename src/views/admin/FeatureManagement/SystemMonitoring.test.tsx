import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({ currentUser: { getIdToken: async () => 'token' } }) }));
vi.mock('./MonitoringChart', () => ({ default: () => null }));
import SystemMonitoring from './SystemMonitoring';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('displays extended request metrics alongside legacy rows and searches fixed operations', async () => {
  const legacy = { id: 'legacy', date: '2026-10-18', source: 'frontend', collection: 'users', feature: 'home',
    reads: 5, writes: 0, deletes: 0, failures: 0, cacheReads: 0 };
  const extended = { ...legacy, id: 'extended', operation: 'home.memberStats', reads: 3,
    requests: 2, readRequests: 2, latencyMs: 100, latencySamples: 2, listenerInitialReads: 3 };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [legacy, extended], truncated: false }) }));
  render(<SystemMonitoring />);
  const operation = await screen.findByText('home.memberStats', {}, { timeout: 20_000 });
  const row = operation.closest('tr')!;
  expect(within(row).getByText('50')).toBeTruthy();
  expect(screen.getAllByText('users')).toHaveLength(2);
  fireEvent.change(screen.getByPlaceholderText('systemMonitoring.search'), { target: { value: 'home.memberStats' } });
  expect(screen.getAllByText('users')).toHaveLength(1);
  expect(screen.getAllByText('systemMonitoring.readRequests').length).toBeGreaterThan(0);
}, 30_000);
