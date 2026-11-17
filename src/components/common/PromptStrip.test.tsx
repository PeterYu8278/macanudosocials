import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PromptStrip, { type PromptItem } from './PromptStrip';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { count: number }) => options ? `${options.count} notices` : key }) }));
vi.mock('@ant-design/icons', () => ({ DownOutlined: () => null, UpOutlined: () => null }));
vi.mock('antd', () => ({
  Tooltip: ({ children }: any) => children,
  Button: ({ children, onClick, 'aria-label': label, 'aria-expanded': expanded }: any) => <button aria-label={label} aria-expanded={expanded} onClick={onClick}>{children}</button>,
}));
const items: PromptItem[] = ['update', 'install', 'push'].map(id => ({
  id, title: `${id} title`, description: `${id} details`, icon: null, action: <button>{id} action</button>,
}));
afterEach(cleanup);

describe('PromptStrip', () => {
  it('renders nothing without notices', () => {
    const { container } = render(<PromptStrip items={[]} />);
    expect(container.childElementCount).toBe(0);
  });
  it('shows one compact notice with details on demand', () => {
    render(<PromptStrip items={items.slice(0, 1)} />);
    expect(screen.getByText('update title')).toBeTruthy();
    expect(screen.queryByText('update details')).toBeNull();
    expect(screen.queryByText('1 notices')).toBeNull();
    fireEvent.click(screen.getByLabelText('homePrompts.expand'));
    expect(screen.getByText('update details')).toBeTruthy();
  });
  it('collapses multiple notices into one and keeps all actions accessible after expansion', () => {
    const { rerender } = render(<PromptStrip items={items} />);
    expect(screen.getByText('3 notices')).toBeTruthy();
    expect(screen.queryByText('install title')).toBeNull();
    fireEvent.click(screen.getByLabelText('homePrompts.expand'));
    expect(screen.getByText('install action')).toBeTruthy();
    expect(screen.getByText('push action')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('homePrompts.collapse'));
    expect(screen.queryByText('push action')).toBeNull();
    rerender(<PromptStrip items={items.slice(1)} />);
    expect(screen.getByText('install title')).toBeTruthy();
    expect(screen.getByText('2 notices')).toBeTruthy();
  });
});
