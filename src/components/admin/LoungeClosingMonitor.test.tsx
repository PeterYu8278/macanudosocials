import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const m = vi.hoisted(() => ({ user: { id: 'admin', role: 'admin', storeId: 'default', storeIds: ['default'] } as any, stores: vi.fn() }));
vi.mock('../../store/modules/auth', () => ({ useAuthStore: () => ({ user: m.user }) }));
vi.mock('../../services/firebase/stores', () => ({ getAllStores: m.stores }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./LoungeOperations', () => ({ LoungeOperations: ({ store }: any) => <button data-testid="operations">Operations: {store.id}</button> }));
import LoungeClosingMonitor from './LoungeClosingMonitor';

const stores = [{ id: 'default', name: 'Macanudo Socials Kota Kinabalu', status: 'active' }, { id: 'other', name: 'Other lounge', status: 'active' }];
beforeEach(() => {
  vi.clearAllMocks(); m.user = { id: 'admin', role: 'admin', storeId: 'default', storeIds: ['default'] };
  m.stores.mockResolvedValue(stores);
  window.matchMedia ||= vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(cleanup);
it.each(['admin', 'superAdmin'])('selects the real lounge automatically for %s and exposes its operation entry', async role => {
  m.user = role === 'superAdmin' ? { id: 'global', role } : m.user;
  render(<LoungeClosingMonitor />);
  expect((await screen.findByTestId('operations')).textContent).toBe('Operations: default');
  expect(document.querySelector('.ant-select-selection-item')?.textContent).toBe('Macanudo Socials Kota Kinabalu');
  expect(m.stores).toHaveBeenCalledWith({ ensureDefault: false });
  fireEvent.mouseDown(screen.getByRole('combobox'));
  await waitFor(() => expect(document.querySelector('.ant-select-item-option-content')?.textContent).toBe('Macanudo Socials Kota Kinabalu'));
});
it('keeps an assigned admin scoped, while allowing a super administrator to switch lounges', async () => {
  const view = render(<LoungeClosingMonitor />);
  await screen.findByTestId('operations'); fireEvent.mouseDown(screen.getByRole('combobox'));
  expect(document.querySelectorAll('.ant-select-item-option-content')).toHaveLength(1);
  view.unmount(); m.user = { id: 'global', role: 'superAdmin' };
  render(<LoungeClosingMonitor />); await screen.findByTestId('operations'); fireEvent.mouseDown(screen.getByRole('combobox'));
  await waitFor(() => expect(document.querySelectorAll('.ant-select-item-option-content')).toHaveLength(2));
  fireEvent.click(screen.getByText('Other lounge'));
  expect(screen.getByTestId('operations').textContent).toBe('Operations: other');
});
it('shows a permission explanation instead of silently disappearing for an unassigned admin', async () => {
  m.user = { id: 'unassigned', role: 'admin' }; render(<LoungeClosingMonitor />);
  expect(await screen.findByText('loungeOperations.noAccessibleLounges')).toBeTruthy();
  expect(screen.queryByTestId('operations')).toBeNull();
});
it('shows a load failure and retries successfully', async () => {
  m.stores.mockRejectedValueOnce(new Error('permission-denied')).mockResolvedValue(stores);
  render(<LoungeClosingMonitor />); expect(await screen.findByText('loungeOperations.loungesLoadFailed')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'common.refresh' }));
  expect(await screen.findByTestId('operations')).toBeTruthy();
});
