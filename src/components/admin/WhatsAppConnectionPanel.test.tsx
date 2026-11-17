import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultWhatsAppSettings, type WhatsAppManagementState } from '../../types/whatsapp'
import WhatsAppConnectionPanel from './WhatsAppConnectionPanel'

const m = vi.hoisted(() => ({ request: vi.fn(), error: vi.fn(), success: vi.fn(), confirm: vi.fn(), changed: vi.fn() }))
vi.mock('../../services/api/whatsapp', () => ({ whatsappRequest: m.request }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@ant-design/icons', () => ({ CheckCircleOutlined: () => null, LinkOutlined: () => null, QrcodeOutlined: () => null, ReloadOutlined: () => null, SaveOutlined: () => null }))
vi.mock('antd', () => {
  const Input = Object.assign((props: any) => <input {...props} />, { Password: ({ visibilityToggle, ...props }: any) => <input type="password" {...props} /> })
  return {
    App: { useApp: () => ({ message: { error: m.error, success: m.success }, modal: { confirm: m.confirm } }) }, Input,
    Alert: ({ message }: any) => <div role="alert">{message}</div>,
    Button: ({ children, disabled, onClick, loading }: any) => <button disabled={disabled || loading} onClick={onClick}>{children}</button>,
    Modal: ({ open, title, children, footer }: any) => open ? <section role="dialog" aria-label={title}>{children}{footer}</section> : null,
    Space: ({ children }: any) => <div>{children}</div>, Tag: ({ children }: any) => <span>{children}</span>, Spin: () => <span>loading</span>,
    Typography: { Title: ({ children }: any) => <h5>{children}</h5>, Text: ({ children }: any) => <span>{children}</span>, Paragraph: ({ children }: any) => <p>{children}</p> },
  }
})
const state = (): WhatsAppManagementState => ({ config: { ...defaultWhatsAppSettings, whapi: { channelId: 'active-channel' } },
  whapiCredentials: true, whapiVerified: false, encryptionReady: true, managed: false, credentialSource: 'environment' })
const session = () => ({ id: 'session-id', target: 'active', channelId: 'active-channel', expiresAtMs: Date.now() + 60000, status: 'unknown' })
beforeEach(() => {
  vi.clearAllMocks(); m.changed.mockResolvedValue(undefined)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  m.request.mockImplementation(async action => {
    if (action === 'connection-start') return { session: session() }
    if (action === 'connection-status') return { status: 'qr', account: null }
    if (action === 'connection-qr') return { qr: 'data:image/png;base64,AAAA', qrExpiresAtMs: Date.now() + 20000 }
    return {}
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('WhatsAppConnectionPanel', () => {
  it('opens an in-memory QR session and clears it immediately on close', async () => {
    render(<WhatsAppConnectionPanel state={state()} onChanged={m.changed} />)
    fireEvent.click(screen.getByText('whatsappConnection.connectActive'))
    await screen.findByAltText('whatsappConnection.qrAlt')
    fireEvent.click(screen.getByText('common.close'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByAltText('whatsappConnection.qrAlt')).toBeNull()
    expect(m.request).toHaveBeenCalledWith('connection-cancel', { sessionId: 'session-id' })
  })
  it('ignores a QR response arriving after the dialog was closed', async () => {
    let resolve!: (value: any) => void
    const pending = new Promise(done => { resolve = done })
    const original = m.request.getMockImplementation()!
    m.request.mockImplementation((action, ...args) => action === 'connection-qr' ? pending : original(action, ...args))
    render(<WhatsAppConnectionPanel state={state()} onChanged={m.changed} />)
    fireEvent.click(screen.getByText('whatsappConnection.connectActive'))
    await waitFor(() => expect(m.request.mock.calls.some(([action]) => action === 'connection-qr')).toBe(true))
    fireEvent.click(screen.getByText('common.close'))
    await act(async () => { resolve({ qr: 'data:image/png;base64,AAAA', qrExpiresAtMs: Date.now() + 20000 }); await pending })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('clears the token input after saving the candidate without switching automatically', async () => {
    render(<WhatsAppConnectionPanel state={state()} onChanged={m.changed} />)
    fireEvent.change(screen.getByLabelText('whatsappConnection.channelId'), { target: { value: 'new-channel' } })
    const input = screen.getByLabelText('whatsappConnection.token') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'secret-token' } })
    fireEvent.click(screen.getByText('whatsappConnection.saveCandidate'))
    await waitFor(() => expect(input.value).toBe(''))
    expect(m.request).toHaveBeenCalledWith('candidate-save', { channelId: 'new-channel', token: 'secret-token' })
    expect(m.request.mock.calls.some(([action]) => action === 'candidate-activate')).toBe(false)
  })
  it('requires a separate confirmation before activating a verified candidate', () => {
    const value = state(); value.candidate = { id: 'candidate', channelId: 'new', account: '***6789', verified: true, expiresAtMs: Date.now() + 60000 }
    render(<WhatsAppConnectionPanel state={value} onChanged={m.changed} />)
    fireEvent.click(screen.getByText('whatsappConnection.activate'))
    expect(m.confirm).toHaveBeenCalledTimes(1)
    expect(m.request).not.toHaveBeenCalled()
  })
})
