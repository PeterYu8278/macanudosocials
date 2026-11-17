import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('deduplicates prefetch/open requests, shows initial loading and keeps cached rows during refresh', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    let resolveStatus!: (value: any) => void;
    const pending = new Promise(resolve => { resolveStatus = resolve; });
    mocks.request.mockImplementation(action => action === 'status' ? pending : Promise.resolve({ channels: [] }));
    render(<LoungeOperations store={store} />);
    const opener = screen.getByRole('button', { name: /loungeOperations.title/ });
    fireEvent.mouseEnter(opener);
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('tab', { name: 'loungeOperations.closing' }));
    expect(mocks.request.mock.calls.filter(([action]) => action === 'status')).toHaveLength(1);
    expect(screen.getByText('loungeOperations.loadingBatches')).toBeTruthy();
    await act(async () => resolveStatus({ enabled: true, batches: [{ id: 'batch', businessDate: '2026-10-31', status: 'completed' }] }));
    expect(screen.getByText('2026-10-31')).toBeTruthy();
    mocks.request.mockImplementation(action => action === 'status' ? new Promise(() => {}) : Promise.resolve({ channels: [] }));
    fireEvent.click(screen.getByRole('button', { name: /common.refresh/ }));
    expect(screen.getByText('2026-10-31')).toBeTruthy();
    expect(screen.getByText('loungeOperations.refreshingBatches')).toBeTruthy();
    expect(screen.queryByText('loungeOperations.loadingBatches')).toBeNull();
  }, 30000);
  it('uses verified system channel choices, preserves unavailable saved channels, and pauses reports on selection', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    mocks.request.mockResolvedValue({ success: true, enabled: true, batches: [], channels: [] });
    render(<LoungeOperations store={{ ...store, operations: { ...emptyLoungeOperations(), whapiChannelId: 'old-channel' } }} />);
    fireEvent.click(screen.getByRole('button', { name: /loungeOperations.title/ }));
    await screen.findByText('loungeOperations.noValidChannels');
    expect(screen.queryByRole('textbox', { name: 'loungeOperations.channel' })).toBeNull();
    expect((screen.getByRole('checkbox', { name: 'loungeOperations.reportEnabled' }) as HTMLInputElement).disabled).toBe(true);
    mocks.request.mockResolvedValue({ success: true, enabled: true, batches: [], channels: [{ provider: 'whapi', channelId: 'verified-channel' }] });
    await waitFor(() => expect((screen.getByRole('button', { name: 'common.refresh' }) as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'common.refresh' })); });
    await waitFor(() => expect(screen.queryByText('loungeOperations.noValidChannels')).toBeNull(), { timeout: 5000 });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'loungeOperations.channel' }));
    fireEvent.click(await screen.findByText('Whapi · verified-channel'));
    expect((screen.getByRole('checkbox', { name: 'loungeOperations.reportEnabled' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('save-hours', { storeId: 'lounge', operations: expect.objectContaining({ whapiChannelId: 'verified-channel', dailyReportEnabled: false }) }));
  }, 30000);
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
    expect(mocks.request.mock.calls.every(([action]) => ['status', 'report-channels'].includes(action))).toBe(true);
  }, 15000);
  it.each([['60199887766', '+60199887766'], ['120363123456789@g.us', '120363123456789@g.us']])('saves report recipient %s without enabling automatic closing', async (input, recipient) => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
    mocks.request.mockResolvedValue({ success: true, enabled: true, batches: [], channels: [{ provider: 'whapi', channelId: 'channel' }] });
    render(<LoungeOperations store={{ ...store, operations: { ...emptyLoungeOperations(), whapiChannelId: 'channel' } }} />);
    fireEvent.click(screen.getByRole('button', { name: /loungeOperations.title/ }));
    const recipientInput = await screen.findByRole('textbox', { name: 'loungeOperations.reportRecipient' });
    expect((recipientInput as HTMLInputElement).maxLength).toBe(64);
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'loungeOperations.reportEnabled' }) as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByRole('textbox', { name: 'loungeOperations.reportRecipient' }), { target: { value: input } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'loungeOperations.reportEnabled' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('save-hours', { storeId: 'lounge', operations: expect.objectContaining({
      enabled: false, dailyReportEnabled: true, reportDelivery: { provider: 'whapi', channelId: 'channel', recipient },
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
