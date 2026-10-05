import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SystemSettingsNav from './SystemSettingsNav';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
describe('system settings category navigation', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  });
  afterEach(cleanup);
  it('marks the active category and selects another category', () => {
    const onChange = vi.fn();
    render(<SystemSettingsNav section="communication" onChange={onChange} />);
    expect(screen.getByRole('button', { name: /systemSettings\.sections\.communication/ }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: /systemSettings\.sections\.payment/ }));
    expect(onChange).toHaveBeenCalledWith('payment');
    expect(screen.getAllByRole('button')).toHaveLength(6);
  });
  it('provides the same six categories in the mobile selector', () => {
    const onChange = vi.fn();
    render(<SystemSettingsNav section="appearance" onChange={onChange} />);
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getAllByText('systemSettings.sections.environment').at(-1)!);
    expect(onChange).toHaveBeenCalledWith('environment', expect.objectContaining({ value: 'environment' }));
  });
});
