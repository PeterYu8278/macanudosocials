import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Store } from '../../types';
import { emptyLoungeOperations } from '../../utils/loungeOperations';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../services/loungeOperations', () => ({ loungeRequest: mocks.request }));
vi.mock('../../store/modules/auth', () => ({ useAuthStore: () => ({ user: { role: 'admin' } }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { LoungeOperations } from './LoungeOperations';
const store = { id: 'lounge', name: 'Test Lounge', status: 'active' } as Store;
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('lounge operations controls', () => {
  it('clears recipient/channel and pauses daily reports when changing provider', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    mocks.request.mockResolvedValue({ success: true, enabled: true, batches: [] });
    render(<LoungeOperations store={{ ...store, operations: { ...emptyLoungeOperations(), dailyReportEnabled: true,
      reportDelivery: { provider: 'whapi', channelId: 'channel', recipient: '+60123456789' } } }} />);
    fireEvent.click(screen.getByRole('button', { name: /loungeOperations.title/ }));
    const selector = await screen.findByRole('combobox', { name: 'loungeOperations.reportProvider' });
    fireEvent.mouseDown(selector);
    fireEvent.click(await screen.findByText('Whatsmeow'));
    expect((screen.getByRole('checkbox', { name: 'loungeOperations.reportEnabled' }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('textbox', { name: 'loungeOperations.channel' }) as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('textbox', { name: 'loungeOperations.reportRecipient' }) as HTMLInputElement).value).toBe('');
    expect(mocks.request.mock.calls.every(([action]) => action === 'status')).toBe(true);
  }, 15000);
  it('saves an explicit report recipient without enabling automatic closing', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    mocks.request.mockResolvedValue({ success: true, enabled: true, batches: [] });
    render(<LoungeOperations store={{ ...store, operations: { ...emptyLoungeOperations(), whapiChannelId: 'channel' } }} />);
    fireEvent.click(screen.getByRole('button', { name: /loungeOperations.title/ }));
    await screen.findByRole('textbox', { name: 'loungeOperations.reportRecipient' });
    fireEvent.change(screen.getByRole('textbox', { name: 'loungeOperations.reportRecipient' }), { target: { value: '+60199887766' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'loungeOperations.reportEnabled' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('save-hours', { storeId: 'lounge', operations: expect.objectContaining({
      enabled: false, dailyReportEnabled: true, reportDelivery: { provider: 'whapi', channelId: 'channel', recipient: '+60199887766' },
    }) }));
  }, 15000);
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
