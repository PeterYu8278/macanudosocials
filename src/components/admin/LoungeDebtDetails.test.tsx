import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LoungeDebtDetails from './LoungeDebtDetails';
import LoungeDebtLedger from './LoungeDebtLedger';
import type { LoungeDebtCustomer } from '../../types/loungeReport';
vi.mock('react-i18next', async () => {
  const { default: i18next } = await import('i18next');
  const { default: english } = await import('../../i18n/locales/en-US.json');
  const instance = i18next.createInstance();
  await instance.init({ lng: 'zh-CN', fallbackLng: 'en-US', resources: { 'en-US': { translation: english } } });
  return { useTranslation: () => ({ t: (key: string) => key, i18n: instance }) };
});
const m = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../services/loungeOperations', () => ({ loungeRequest: m.request }));
vi.mock('../../store/modules/auth', () => ({ useAuthStore: () => ({ user: { role: 'admin' } }) }));
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('lounge debt evidence view', () => {
  it.each([true, false])('keeps English historical descriptions and original references in compact=%s layout', compact => {
    const row: LoungeDebtCustomer = { userId: 'member', name: 'Member', memberId: 'MEM', reliable: true, reasons: [],
      walletBalance: 46, opening: 0, added: 0, repaid: 0, outstanding: 0, entryCount: 1,
      entries: [{ id: 'long-original-ledger-reference', at: '2026-10-25T12:00:00Z', amount: -18,
        before: null, after: null, calculatedBefore: 64, calculatedAfter: 46, source: 'visit', local: true,
        historical: true, relatedId: '', participation: 'historical-included', description: '驻店计时扣费 (0.5166666666666667小时，共18积分) (H)' }] };
    const original = JSON.stringify(row);
    render(<LoungeDebtLedger row={row} compact={compact} time={value => value || '—'} />);
    expect(screen.getByText('Visit duration fee (0.52 h, 18 points) (H)')).toBeTruthy();
    expect(screen.getByText('long-original-ledger-reference')).toBeTruthy();
    expect(screen.getAllByText('loungeOperations.debt.calculated')).toHaveLength(2);
    expect(JSON.stringify(row)).toBe(original);
  });
  it('shows missing evidence for a legacy report', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    m.request.mockResolvedValue({ debtDetails: null });
    render(<LoungeDebtDetails storeId="lounge" reportId="report" autoOpen />);
    expect(await screen.findByText('loungeOperations.debt.legacy')).toBeTruthy();
  });
  it('shows review reasons and frozen ledger references', async () => {
    render(<LoungeDebtDetails storeId="lounge" autoOpen details={{ businessDate: '2026-10-25',
      from: '2026-10-24T16:00:00Z', to: '2026-10-26T14:00:00Z', historical: true, truncated: false, otherReviewCount: 0,
      customers: [{ userId: 'user', name: 'Test customer', memberId: 'MEM001', reliable: false, reasons: ['wallet-mismatch'],
        walletBalance: -50, opening: null, added: null, repaid: null, outstanding: null, entryCount: 1,
        entries: [{ id: 'ledger123', at: '2026-10-25T12:00:00Z', amount: -20, before: null, after: null, calculatedBefore: 20, calculatedAfter: 0,
          source: 'visit', relatedId: 'visit123', description: '驻店计时扣费 (0.55小时，共18积分) (H)', historical: true, local: true }] }] }} />);
    fireEvent.click(screen.getByRole('tab', { name: /loungeOperations.debt.group.review/ }));
    expect(await screen.findByText('Test customer')).toBeTruthy();
    expect(screen.getByText('loungeOperations.debt.reasons.wallet-mismatch')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Expand row/ }));
    expect(await screen.findByText('ledger123')).toBeTruthy();
    expect(screen.getByText('Visit duration fee (0.55 h, 18 points) (H)')).toBeTruthy();
    expect(screen.queryByText(/驻店计时扣费/)).toBeNull();
    expect(screen.getByText('visit123')).toBeTruthy();
    expect(screen.getAllByText('loungeOperations.debt.calculated')).toHaveLength(2);
    expect(m.request).not.toHaveBeenCalled();
  });
});
