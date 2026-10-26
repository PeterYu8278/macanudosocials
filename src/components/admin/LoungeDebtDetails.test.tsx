import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LoungeDebtDetails from './LoungeDebtDetails';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }) }));
const m = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../services/loungeOperations', () => ({ loungeRequest: m.request }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('lounge debt evidence view', () => {
  it('shows missing evidence for a legacy report', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() });
    m.request.mockResolvedValue({ debtDetails: null });
    render(<LoungeDebtDetails storeId="lounge" reportId="report" autoOpen />);
    expect(await screen.findByText('loungeOperations.debt.legacy')).toBeTruthy();
  });
  it('shows review reasons and frozen ledger references', async () => {
    render(<LoungeDebtDetails storeId="lounge" autoOpen details={{ businessDate: '2026-10-25',
      from: '2026-10-24T16:00:00Z', to: '2026-10-26T14:00:00Z', historical: true, truncated: false, otherReviewCount: 0,
      customers: [{ userId: 'user', name: 'Test customer', memberId: 'MEM001', reliable: false, reasons: ['wallet-mismatch'],
        walletBalance: -50, opening: null, added: null, repaid: null, outstanding: null, entryCount: 1,
        entries: [{ id: 'ledger123', at: '2026-10-25T12:00:00Z', amount: -20, before: 0, after: -20,
          source: 'visit', relatedId: 'visit123', description: 'Visit fee', local: true }] }] }} />);
    expect(await screen.findByText('Test customer')).toBeTruthy();
    expect(screen.getByText('loungeOperations.debt.reasons.wallet-mismatch')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Expand row/ }));
    expect(await screen.findByText('ledger123')).toBeTruthy();
    expect(screen.getByText('visit123')).toBeTruthy();
    expect(m.request).not.toHaveBeenCalled();
  });
});
