import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SystemUpdateBanner from './SystemUpdateBanner';

const state = vi.hoisted(() => ({ available: false, apply: vi.fn() }));
vi.mock('../../utils/pwa', () => ({
  useSystemUpdate: () => state.available,
  applySystemUpdate: state.apply,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@ant-design/icons', () => ({ ReloadOutlined: () => null, DownOutlined: () => null, UpOutlined: () => null }));
vi.mock('antd', () => ({
  Tooltip: ({ children }: any) => children,
  Button: ({ children, loading, onClick, 'aria-label': label }: any) => <button aria-label={label} disabled={loading} onClick={onClick}>{children}</button>,
}));

describe('SystemUpdateBanner', () => {
  beforeEach(() => { state.available = false; state.apply.mockReset(); });
  afterEach(cleanup);

  it('stays hidden when no update is ready', () => {
    render(<SystemUpdateBanner />);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('requires user action and permits retry when activation fails', async () => {
    state.available = true;
    state.apply.mockResolvedValue(false);
    render(<SystemUpdateBanner />);
    expect(state.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'systemUpdate.updateNow' }));
    await screen.findByText('systemUpdate.failed');
    expect(state.apply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'systemUpdate.updateNow' }));
    await waitFor(() => expect(state.apply).toHaveBeenCalledTimes(2));
  });
});
