import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const m = vi.hoisted(() => ({ user: null as any, loading: false, record: vi.fn(), page: vi.fn(), flush: vi.fn() }));
vi.mock('../../store/modules/auth', () => ({ useAuthStore: () => ({ user: m.user, loading: m.loading }) }));
vi.mock('../../services/websiteTraffic', () => ({ recordWebsiteEvent: m.record, setTrafficPage: m.page, flushWebsiteTraffic: m.flush, touchWebsiteSession: vi.fn() }));
import WebsiteTrafficTracker from './WebsiteTrafficTracker';
beforeEach(() => { vi.clearAllMocks(); m.user = null; m.loading = false; vi.useFakeTimers(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const surface = (key: string, path = '/') => <StrictMode><MemoryRouter initialEntries={[{ pathname: path, key }]}><WebsiteTrafficTracker guestVisible /></MemoryRouter></StrictMode>;
it('records one PV across StrictMode remounts and one engagement after ten visible seconds', () => {
  render(surface('strict-view')); expect(m.record.mock.calls.filter(([kind]) => kind === 'page_view')).toHaveLength(1);
  act(() => { vi.advanceTimersByTime(10000); });
  expect(m.record.mock.calls.filter(([kind]) => kind === 'engaged_visit')).toHaveLength(1);
});
it.each(['admin', 'storeAdmin', 'superAdmin', 'developer'])('excludes %s visits', role => {
  m.user = { id: 'staff', role }; render(surface(role)); expect(m.record).not.toHaveBeenCalled();
});
it('distinguishes the signed-in Home from Guest Page and skips management routes', () => {
  m.user = { id: 'member', role: 'vip' }; const view = render(surface('member-home'));
  expect(m.page).toHaveBeenCalledWith('member_home'); view.unmount(); m.record.mockClear();
  render(surface('private-path', '/admin')); expect(m.record).not.toHaveBeenCalled();
});
it('does not record hidden-tab time as engagement', () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  render(surface('hidden-view')); act(() => vi.advanceTimersByTime(20000)); expect(m.record).not.toHaveBeenCalled();
});
