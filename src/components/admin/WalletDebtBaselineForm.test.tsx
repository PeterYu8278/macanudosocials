import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const m = vi.hoisted(() => ({ user: { role: 'developer' }, request: vi.fn() }));
vi.mock('../../store/modules/auth', () => ({ useAuthStore: () => ({ user: m.user }) }));
vi.mock('../../services/loungeOperations', () => ({ loungeRequest: m.request }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import WalletDebtBaselineForm from './WalletDebtBaselineForm';
describe('verified historical balance baseline form', () => {
  beforeEach(() => {
    m.user.role = 'developer'; m.request.mockReset().mockResolvedValue({ baseline: { version: 3 } });
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() });
  });
  afterEach(cleanup);
  it('does not offer baseline approval to ordinary staff', () => {
    m.user.role = 'storeAdmin'; render(<WalletDebtBaselineForm storeId="lounge" userId="member" />);
    expect(screen.queryByRole('button')).toBeNull(); expect(m.request).not.toHaveBeenCalled();
  });
  it('requires independent evidence and uses an explicit MYT cutoff, never a prefilled current balance', async () => {
    render(<WalletDebtBaselineForm storeId="lounge" userId="member" />);
    fireEvent.click(screen.getByRole('button', { name: 'loungeOperations.debt.registerBaseline' }));
    await waitFor(() => expect(m.request).toHaveBeenCalledWith('debt-baseline', { storeId: 'lounge', userId: 'member' }));
    const balance = await screen.findByRole('spinbutton');
    expect((balance as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('loungeOperations.debt.baselineAt'), { target: { value: '2026-10-20T15:00:05' } });
    fireEvent.change(balance, { target: { value: '156' } });
    fireEvent.change(screen.getByLabelText('loungeOperations.debt.evidenceReference'), { target: { value: 'verified-archive/member' } });
    fireEvent.change(screen.getByLabelText('loungeOperations.debt.reviewNote'), { target: { value: 'Independently reviewed original balance and cutoff' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'loungeOperations.debt.baselineConfirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(m.request).toHaveBeenCalledWith('save-debt-baseline', expect.objectContaining({
      storeId: 'lounge', userId: 'member', balance: 156, expectedVersion: 3,
      at: Date.parse('2026-10-20T15:00:05+08:00'), confirm: true,
    })));
    expect(await screen.findByText('loungeOperations.debt.baselineSaved')).toBeTruthy();
  });
});
