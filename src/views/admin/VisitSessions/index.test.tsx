import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cigars: vi.fn(),
  t: (key: string) => key,
  user: { id: 'admin', role: 'admin' },
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t, i18n: { language: 'en-US' } }) }));
vi.mock('antd', async original => ({
  ...(await original<any>()),
  App: { useApp: () => ({ message: mocks.message, modal: {} }) },
}));
vi.mock('../../../store/modules/auth', () => ({ useAuthStore: () => ({ user: mocks.user, isSuperAdmin: true }) }));
vi.mock('../../../services/firebase/firestore', () => ({
  getCigars: mocks.cigars, getDocument: async () => null, COLLECTIONS: { USERS: 'users' },
}));
vi.mock('../../../services/firebase/visitSessions', () => ({
  getUserVisitSessions: async () => [], getAllPendingVisitSessions: async () => [],
  getAllVisitSessions: async () => [], getExpiredVisitSessions: async () => [],
  completeVisitSession: vi.fn(), addRedemptionToSession: vi.fn(),
}));
vi.mock('../../../services/firebase/redemption', () => ({
  createRedemptionRecord: vi.fn(), updateRedemptionRecord: vi.fn(),
  getRedemptionRecordsBySession: async () => [],
  getAllRedemptionRecords: async () => [{
    id: 'pending', userId: 'member', userName: 'Member', cigarName: '',
    quantity: 1, status: 'pending', redeemedAt: new Date(),
  }],
}));
vi.mock('../../../services/firebase/stores', () => ({ getAllStores: async () => [] }));
vi.mock('../../../services/firebase/userDisplayNames', () => ({ getUserDisplayNames: async () => ({}) }));
vi.mock('../../../services/firebase/featureVisibility', () => ({ isFeatureVisible: async () => false }));
vi.mock('../../../components/admin/QRScanner', () => ({ QRScanner: () => null }));
vi.mock('../../../components/admin/RoomManagement', () => ({ RoomManagement: () => null }));

import VisitSessionsPage from './index';

describe('visit session redemption cigar loading', () => {
  beforeEach(() => {
    mocks.cigars.mockReset();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    });
  });
  afterEach(cleanup);

  async function openRedemption() {
    render(<VisitSessionsPage />);
    await waitFor(() => expect(mocks.cigars).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: /visitSessions.mysteryGiftRedemptions/ }));
    fireEvent.click(await screen.findByRole('button', { name: /common.edit/ }));
    return screen.findByRole('dialog');
  }

  it('shows a silent fetch failure and recovers options after retry', async () => {
    mocks.cigars.mockRejectedValue(new Error('permission-denied'));
    const dialog = await openRedemption();
    expect(await within(dialog).findByText('permission-denied', { exact: false })).toBeTruthy();
    expect(within(dialog).getByText('visitSessions.loadCigarsFailed')).toBeTruthy();
    mocks.cigars.mockResolvedValue([{ id: 'cigar', name: 'Robusto', price: 99 }]);
    fireEvent.click(within(dialog).getByRole('button', { name: /common.retry/ }));
    await waitFor(() => expect(within(dialog).queryByText('visitSessions.loadCigarsFailed')).toBeNull());
    fireEvent.mouseDown(within(dialog).getByRole('combobox'));
    expect(await screen.findByText('Robusto - RM99')).toBeTruthy();
  }, 20000);

  it('reloads cigars and portals options outside the modal without scale motion', async () => {
    mocks.cigars.mockResolvedValueOnce([]).mockResolvedValue([{ id: 'cigar', name: 'Robusto', price: 99 }]);
    const dialog = await openRedemption();
    await waitFor(() => expect(mocks.cigars).toHaveBeenCalledTimes(2));
    fireEvent.mouseDown(within(dialog).getByRole('combobox'));
    const option = await screen.findByText('Robusto - RM99');
    const popup = option.closest('.ant-select-dropdown');
    expect(popup).toBeTruthy();
    expect(popup?.parentElement).toBe(document.body);
    expect(popup?.closest('.ant-modal')).toBeNull();
    expect(popup?.className).not.toMatch(/ant-slide-up/);
  }, 20000);
});
