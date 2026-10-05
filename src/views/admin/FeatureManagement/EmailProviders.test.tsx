import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppConfig } from '../../../types'
import EmailProviders from './EmailProviders'

const update = vi.hoisted(() => vi.fn())
vi.mock('../../../services/firebase/appConfig', () => ({ updateAppConfig: update }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
describe('email provider selection', () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue({ success: true })
    window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  })
  afterEach(cleanup)
  it('loads and saves the configured provider without introducing credential fields', async () => {
    const onSaved = vi.fn()
    render(<App><EmailProviders config={{ emailProviders: { passwordReset: 'resend', emailChange: 'resend' } } as AppConfig} userId="admin" onSaved={onSaved} /></App>)
    expect(screen.queryByText('API Key')).toBeNull()
    expect(screen.getAllByText('Resend').length).toBeGreaterThan(1)
    fireEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(update).toHaveBeenCalledWith({ emailProviders: { passwordReset: 'resend', emailChange: 'resend' } }, 'admin'))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })
  it('defaults to Firebase and preserves the current cancellable email confirmation provider', async () => {
    render(<App><EmailProviders config={{} as AppConfig} userId="admin" onSaved={vi.fn()} /></App>)
    fireEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(update).toHaveBeenCalledWith({ emailProviders: { passwordReset: 'firebase', emailChange: 'resend' } }, 'admin'))
  })
  it('does not report a failed save as successful', async () => {
    update.mockResolvedValue({ success: false, error: 'unavailable' })
    const onSaved = vi.fn()
    render(<App><EmailProviders config={{} as AppConfig} userId="admin" onSaved={onSaved} /></App>)
    fireEvent.click(screen.getByText('common.save'))
    await screen.findByText('communications.saveFailed')
    expect(onSaved).not.toHaveBeenCalled()
  })
})
