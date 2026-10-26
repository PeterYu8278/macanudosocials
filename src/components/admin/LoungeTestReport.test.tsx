import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Modal } from 'antd';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../../services/loungeOperations', () => ({ loungeRequest: mocks.request }));
vi.mock('../../store/modules/auth', () => ({ useAuthStore: () => ({ user: { role: 'admin' } }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import LoungeTestReport from './LoungeTestReport';
beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); mocks.request.mockReset(); });
describe('independent test report controls', () => {
  it('previews first and requires confirmation before sending the same draft', async () => {
    const confirm = vi.spyOn(Modal, 'confirm').mockImplementation(() => ({ destroy: vi.fn(), update: vi.fn() }));
    mocks.request.mockResolvedValueOnce({ success: true, draftId: 'draft', text: '[TEST] English report', channelId: 'channel', recipient: '***6789', expiresAt: '2099-01-01' })
      .mockResolvedValueOnce({ success: true, status: 'accepted' });
    render(<LoungeTestReport storeId="lounge" />);
    expect(screen.queryByRole('button', { name: /loungeOperations.test.send/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /loungeOperations.test.preview/ }));
    await screen.findByText('[TEST] English report');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /loungeOperations.test.send/ }));
    expect(confirm).toHaveBeenCalledOnce(); expect(mocks.request).toHaveBeenCalledTimes(1);
    await act(async () => { await confirm.mock.calls[0][0].onOk?.(); });
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('test-report-send', { storeId: 'lounge', draftId: 'draft', confirm: true }));
  }, 15000);
  it('discards an old preview when the business date changes', async () => {
    mocks.request.mockResolvedValue({ success: true, draftId: 'draft', text: '[TEST] English report', channelId: 'channel', recipient: '***6789' });
    render(<LoungeTestReport storeId="lounge" />);
    fireEvent.click(screen.getByRole('button', { name: /loungeOperations.test.preview/ }));
    await screen.findByText('[TEST] English report');
    fireEvent.change(screen.getByLabelText('loungeOperations.date'), { target: { value: '2000-01-01' } });
    expect(screen.queryByText('[TEST] English report')).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  }, 15000);
});
