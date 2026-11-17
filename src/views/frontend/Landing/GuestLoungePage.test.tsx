import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import english from '../../../i18n/locales/en-US.json';
import chinese from '../../../i18n/locales/zh-CN.json';
import { DEFAULT_GUEST_PAGE } from '../../../config/guestPage';
import GuestLoungePage from './GuestLoungePage';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('uses the configured brand logo, verified visit details and interactive room photos', async () => {
  const i = i18next.createInstance();
  await i.init({ lng: 'en-US', resources: { 'en-US': { translation: english }, 'zh-CN': { translation: chinese } } });
  const login = vi.fn(), register = vi.fn();
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    set src(_value: string) { this.onload?.(); }
  });
  render(<I18nextProvider i18n={i}><GuestLoungePage config={DEFAULT_GUEST_PAGE} logoUrl="/configured-logo.png" onLogin={login} onRegister={register} /></I18nextProvider>);
  const logos = screen.getAllByAltText(DEFAULT_GUEST_PAGE.loungeName);
  expect(logos).toHaveLength(2);
  expect(logos.every(logo => logo.getAttribute('src') === '/configured-logo.png')).toBe(true);
  fireEvent.error(logos[0]);
  expect(logos[0].getAttribute('src')).toBe('/icons/app-logo-192.png');
  expect(screen.getByText(/11:00–23:00/)).toBeTruthy();
  expect(screen.getByText(DEFAULT_GUEST_PAGE.address)).toBeTruthy();
  const table = screen.getByRole('button', { name: /Around the table/ });
  fireEvent.click(table);
  expect(table.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByAltText(english.guestLounge.rooms.table.alt).getAttribute('src')).toBe('/lounge/social-table.png');
  fireEvent.click(screen.getByRole('button', { name: 'Member sign-in' }));
  expect(login).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Register your interest' }));
  expect(register).toHaveBeenCalledOnce();
  const menu = screen.getByRole('button', { name: 'Open menu' });
  fireEvent.click(menu);
  expect(menu.getAttribute('aria-expanded')).toBe('true');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(menu.getAttribute('aria-expanded')).toBe('false');
});
