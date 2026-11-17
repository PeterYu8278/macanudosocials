import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { LegacyMigrationMaintenance } from './LegacyMigrationMaintenance'

vi.mock('../../config/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'test-token' } } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
const current = `legacy_${'a'.repeat(24)}`, old = `legacy_${'b'.repeat(24)}`
const response = (body: object) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })
const renderPanel = () => render(<App><LegacyMigrationMaintenance batchId={current} disabled={false} canOverwrite phones={[]}
  onBusyChange={() => {}} onCleaned={async () => {}} /></App>)

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('legacy batch selection diagnostics', () => {
  it('keeps backend failure visible rather than implying current workbook is the only database batch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'Proxy error' }))
    renderPanel()
    await waitFor(() => expect(screen.getByText('usersAdmin.migrationBatchListFailed')).toBeTruthy())
    expect(screen.getByText('usersAdmin.migrationBackendUnavailable')).toBeTruthy()
    expect(screen.queryByText('usersAdmin.migrationNoRegisteredBatches')).toBeNull()
  })
  it('retries a failed list request and clears the persistent error after success', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500, text: async () => '' })
      .mockResolvedValueOnce(response({ success: true, batches: [{ id: old, fileName: 'old.xlsx' }] }))
    vi.stubGlobal('fetch', fetch)
    renderPanel()
    await screen.findByText('usersAdmin.migrationBatchListFailed')
    fireEvent.click(screen.getByRole('button', { name: /common.retry/ }))
    await waitFor(() => expect(screen.queryByText('usersAdmin.migrationBatchListFailed')).toBeNull())
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('accepts an unregistered old batch ID and previews that batch without deleting records', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ success: true, batches: [] }))
      .mockResolvedValueOnce(response({ success: true, token: 'preview', total: 0, counts: {} }))
    vi.stubGlobal('fetch', fetch)
    renderPanel()
    await screen.findByText('usersAdmin.migrationNoRegisteredBatches')
    const input = screen.getByPlaceholderText('usersAdmin.migrationManualBatchPlaceholder')
    fireEvent.change(input, { target: { value: old } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: /usersAdmin.migrationPreviewCleanup/ }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: 'preview', batchId: old })
  })
})
