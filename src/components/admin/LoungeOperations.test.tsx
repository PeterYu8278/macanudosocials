import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Store } from '../../types';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../services/loungeOperations', () => ({ loungeRequest: mocks.request }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { LoungeOperations } from './LoungeOperations';
const store = { id: 'lounge', name: 'Test Lounge', status: 'active' } as Store;
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('lounge operations controls', () => {
  it('keeps activation disabled until the server reports readiness', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    mocks.request.mockResolvedValue({ success: true, enabled: false, batches: [] });
    render(<LoungeOperations store={store} />);
    fireEvent.click(screen.getByRole('button', { name: /loungeOperations.title/ }));
    await screen.findByText('loungeOperations.disabled');
    expect(screen.getByRole('tab', { name: 'loungeOperations.test.title' })).toBeTruthy();
    expect((screen.getAllByRole('switch')[0] as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.request).toHaveBeenCalledWith('status', { storeId: 'lounge' });
  }, 15000);
  it('saves disabled schedules through the audited backend without activating the lounge', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    mocks.request.mockResolvedValue({ success: true, enabled: true, batches: [] });
    const saved = vi.fn();
    render(<LoungeOperations store={store} onSaved={saved} />);
    fireEvent.click(screen.getByRole('button', { name: /loungeOperations.title/ }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('save-hours', {
      storeId: 'lounge', operations: expect.objectContaining({ enabled: false, timezone: 'Asia/Kuala_Lumpur', dailyReportEnabled: false }),
    }));
    expect(saved).toHaveBeenCalled();
  }, 15000);
});
