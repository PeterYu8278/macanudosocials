import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SystemUpdateBanner from './SystemUpdateBanner';

const state = vi.hoisted(() => ({ available: false, apply: vi.fn() }));
vi.mock('../../utils/pwa', () => ({
  useSystemUpdate: () => state.available,
  applySystemUpdate: state.apply,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@ant-design/icons', () => ({ ReloadOutlined: () => null }));
vi.mock('antd', () => ({
  Alert: ({ message, description }: any) => <section role="alert">{message}{description}</section>,
  Button: ({ children, loading, onClick }: any) => <button disabled={loading} onClick={onClick}>{children}</button>,
}));

describe('SystemUpdateBanner', () => {
  beforeEach(() => { state.available = false; state.apply.mockReset(); });
  afterEach(cleanup);

  it('stays hidden when no update is ready', () => {
    render(<SystemUpdateBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('requires user action and permits retry when activation fails', async () => {
    state.available = true;
    state.apply.mockResolvedValue(false);
    render(<SystemUpdateBanner />);
    expect(state.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText('systemUpdate.failed');
    expect(state.apply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(state.apply).toHaveBeenCalledTimes(2));
  });
});
