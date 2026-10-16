import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cigars: vi.fn(),
  recentSessions: vi.fn(),
  checkout: vi.fn(),
  confirm: vi.fn(),
  warning: vi.fn(),
  t: (key: string) => key,
  user: { id: 'admin', role: 'admin' },
  message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t, i18n: { language: 'en-US' } }) }));
vi.mock('antd', async original => ({
  ...(await original<any>()),
  App: { useApp: () => ({ message: mocks.message, modal: { confirm: mocks.confirm, warning: mocks.warning } }) },
  Table: ({ dataSource = [], columns = [] }: any) => <div>{dataSource.map((record: any) => (
    <div key={record.id}>{columns.map((column: any) => <div key={column.key || column.dataIndex}>
      {column.render ? column.render(record[column.dataIndex], record) : record[column.dataIndex]}
    </div>)}</div>
  ))}</div>,
}));
vi.mock('../../../store/modules/auth', () => ({ useAuthStore: () => ({ user: mocks.user, isSuperAdmin: true }) }));
vi.mock('../../../services/firebase/firestore', () => ({
  getCigars: mocks.cigars, getDocument: async () => null, COLLECTIONS: { USERS: 'users' },
}));
vi.mock('../../../services/firebase/visitSessions', () => ({
  getUserVisitSessions: async () => [], getAllPendingVisitSessions: async () => [],
  getAllVisitSessions: mocks.recentSessions, getExpiredVisitSessions: async () => [],
  completeVisitSession: mocks.checkout, addRedemptionToSession: vi.fn(),
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
import CigarSelect from './CigarSelect';

describe('visit session redemption cigar loading', () => {
  beforeEach(() => {
    mocks.cigars.mockReset();
    mocks.recentSessions.mockReset().mockResolvedValue([]);
    mocks.checkout.mockReset();
    mocks.confirm.mockReset();
    mocks.warning.mockReset();
    mocks.message.error.mockClear();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    });
  });
  afterEach(cleanup);

  it.each([true, false])('uses a persistent modal only for insufficient points (insufficient: %s)', async insufficient => {
    mocks.cigars.mockResolvedValue([]);
    mocks.recentSessions.mockResolvedValue([{
      id: 'visit', userId: 'member', userName: 'Member', storeId: 'lounge', status: 'pending',
      checkInAt: new Date('2026-10-15T12:00:00Z'), checkInBy: 'admin',
      createdAt: new Date(), updatedAt: new Date(),
    }]);
    const error = insufficient ? 'Current balance: 64; amount due: 513; shortfall: 449; minimum reload: RM 200.' : 'Other checkout failure';
    mocks.checkout.mockResolvedValue({ success: false, error, ...(insufficient ? { code: 'INSUFFICIENT_POINTS' } : {}) });
    render(<VisitSessionsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /visitSessions.checkout$/ }, { timeout: 15000 }));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    await act(async () => { await mocks.confirm.mock.calls[0][0].onOk(); });
    if (insufficient) {
      expect(mocks.warning).toHaveBeenCalledWith(expect.objectContaining({
        title: 'visitSessions.insufficientPointsTitle', content: error, okText: 'common.confirm', centered: true, maskClosable: false,
      }));
      expect(mocks.message.error).not.toHaveBeenCalled();
    } else {
      expect(mocks.warning).not.toHaveBeenCalled();
      expect(mocks.message.error).toHaveBeenCalledWith(error);
    }
  }, 60000);

  it('filters options, selects with the keyboard and keeps Escape inside the selector', () => {
    const onChange = vi.fn();
    const parentKeyDown = vi.fn();
    render(<div onKeyDown={parentKeyDown}><CigarSelect options={[
      { value: 'one', label: 'Robusto - RM99' },
      { value: 'two', label: 'Toro - RM99' },
    ]} onChange={onChange} /></div>);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'toro' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('two');
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('two');
    fireEvent.click(input);
    parentKeyDown.mockClear();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

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
    fireEvent.focus(within(dialog).getByRole('combobox'));
    expect(await screen.findByText('Robusto - RM99')).toBeTruthy();
  }, 60000);

  it('reloads cigars and keeps searchable options in the modal document flow', async () => {
    mocks.cigars.mockResolvedValueOnce([]).mockResolvedValue([{ id: 'cigar', name: 'Robusto', price: 99 }]);
    const dialog = await openRedemption();
    await waitFor(() => expect(mocks.cigars).toHaveBeenCalledTimes(2));
    fireEvent.focus(within(dialog).getByRole('combobox'));
    const option = await screen.findByText('Robusto - RM99');
    expect(within(dialog).getByRole('listbox').contains(option)).toBe(true);
    expect(option.closest('.ant-select-dropdown')).toBeNull();
    fireEvent.click(option);
    expect((within(dialog).getByRole('combobox') as HTMLInputElement).value).toBe('Robusto - RM99');
    expect(within(dialog).queryByRole('listbox')).toBeNull();
  }, 60000);
});
