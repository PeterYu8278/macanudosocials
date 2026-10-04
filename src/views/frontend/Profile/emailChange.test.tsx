import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  user: null as any, authUser: null as any,
  updateProfile: vi.fn(), getUser: vi.fn(), setUser: vi.fn(), verifyPhone: vi.fn(), verifyEmail: vi.fn(),
  phone: vi.fn(), requestEmail: vi.fn(), email: vi.fn(), verifyCurrent: vi.fn(),
}))
vi.mock('../../../config/firebase', () => ({ auth: { get currentUser() { return mocks.authUser } }, db: {} }))
vi.mock('../../../store/modules/auth', () => ({ useAuthStore: () => ({ user: mocks.user, setUser: mocks.setUser }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US', changeLanguage: vi.fn() } }) }))
vi.mock('../../../i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../../services/firebase/firestore', () => ({ updateDocument: mocks.updateProfile, getUserById: mocks.getUser }))
vi.mock('../../../services/firebase/auth', () => ({ logoutUser: vi.fn() }))
vi.mock('../../../services/firebase/memberPhone', () => ({ updateMemberPhone: mocks.phone }))
vi.mock('../../../services/firebase/memberEmail', async original => ({
  ...(await original<any>()), requestMemberEmailVerification: mocks.requestEmail, updateMemberEmail: mocks.email, verifyCurrentMemberEmail: mocks.verifyCurrent,
}))
vi.mock('../../../hooks/usePhoneChangeVerification', () => ({ usePhoneChangeVerification: () => ({ verifyPhoneChange: mocks.verifyPhone, verifyEmailChange: mocks.verifyEmail, phoneVerificationModal: null }) }))
vi.mock('../../../components/common/ProfileView', () => ({ ProfileView: ({ onEdit, user }: any) => <button onClick={() => onEdit(user)}>Edit member</button> }))
vi.mock('../../../components/common/ImageUpload', () => ({ default: () => null }))
vi.mock('../../../components/common/LanguageSelect', () => ({ default: () => null }))
vi.mock('../../../utils/pwa', () => ({ usePWA: () => ({ checkForUpdates: vi.fn() }) }))
vi.mock('../../../utils/clearApplicationCache', () => ({ clearApplicationCache: vi.fn() }))
vi.mock('../../../services/oneSignal', () => ({ disablePushSubscription: vi.fn(), requestPushSubscription: vi.fn(), syncPushSubscriptionToFirestore: vi.fn() }))
vi.mock('../../../store/modules/pushNotifications', () => ({ usePushNotificationStore: (selector: any) => selector({ status: 'unsupported', busy: false, setBusy: vi.fn(), setSnapshot: vi.fn() }) }))
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), query: vi.fn(), where: vi.fn(), limit: vi.fn(), getDocs: async () => ({ empty: true }) }))
import Profile from './index'

async function edit() {
  fireEvent.click(screen.getByText('Edit member'))
  const input = await screen.findByLabelText('auth.email')
  await waitFor(() => expect((input as HTMLInputElement).value).toBe('old@example.com'))
  return input
}

describe('profile email save flow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.user = { id: 'member', displayName: 'Member', email: 'old@example.com', role: 'member', profile: { phone: '+60123456789' }, preferences: { locale: 'en-US', notifications: true }, emailAuth: { uid: 'member', verified: true } }
    mocks.authUser = { uid: 'member', email: 'old@example.com', emailVerified: true, phoneNumber: '+60123456789', reload: vi.fn().mockResolvedValue(undefined) }
    mocks.getUser.mockImplementation(async () => mocks.user)
    mocks.updateProfile.mockResolvedValue({ success: true })
    mocks.verifyPhone.mockResolvedValue(true)
    mocks.verifyEmail.mockResolvedValue(true)
    mocks.email.mockResolvedValue({ success: true })
    Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
  })
  afterEach(() => cleanup())

  it('does not verify or send a confirmation when the email is unchanged', async () => {
    render(<Profile />)
    await edit()
    fireEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalled())
    expect(mocks.verifyEmail).not.toHaveBeenCalled()
    expect(mocks.requestEmail).not.toHaveBeenCalled()
    expect(mocks.updateProfile.mock.calls[0][2]).not.toHaveProperty('email')
  })

  it('requests confirmation after identity verification, without prematurely writing the new email', async () => {
    render(<Profile />)
    fireEvent.change(await edit(), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(mocks.requestEmail).toHaveBeenCalledWith('member', 'new@example.com'))
    expect(mocks.verifyEmail).toHaveBeenCalledWith({ memberName: 'Member', email: 'new@example.com' })
    await waitFor(() => expect(mocks.updateProfile).toHaveBeenCalled())
    expect(mocks.updateProfile.mock.calls[0][2]).not.toHaveProperty('email')
    expect(mocks.setUser.mock.calls.every(([user]) => user.email === 'old@example.com')).toBe(true)
  })

  it('cancels saving when identity verification is cancelled', async () => {
    mocks.verifyEmail.mockResolvedValue(false)
    render(<Profile />)
    fireEvent.change(await edit(), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(mocks.verifyEmail).toHaveBeenCalled())
    expect(mocks.requestEmail).not.toHaveBeenCalled()
    expect(mocks.updateProfile).not.toHaveBeenCalled()
  })

  it('keeps the editor open and does not report a saved email if sending confirmation fails', async () => {
    mocks.requestEmail.mockRejectedValue(new Error('mail failed'))
    render(<Profile />)
    fireEvent.change(await edit(), { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByText('common.save'))
    await waitFor(() => expect(mocks.requestEmail).toHaveBeenCalled())
    expect(mocks.updateProfile).not.toHaveBeenCalled()
    expect(screen.getByLabelText('auth.email')).toBeTruthy()
  })

  it('allows Google-linked members to edit their primary email', async () => {
    mocks.user.providerData = [{ providerId: 'google.com' }]
    render(<Profile />)
    expect((await edit() as HTMLInputElement).disabled).toBe(false)
  })

  it('shows an unsent request with cancellation and keeps actions below the email', async () => {
    mocks.user.emailChange = { status: 'requested', email: 'new@example.com' }
    render(<Profile />)
    expect(screen.getByText('profile.emailSync.requestTitle')).toBeTruthy()
    const email = screen.getByText('new@example.com')
    const cancel = screen.getByRole('button', { name: /profile.emailSync.cancel$/ })
    expect(email.closest('.ant-alert-description')?.contains(cancel)).toBe(true)
    fireEvent.click(cancel)
    await waitFor(() => expect(mocks.email).toHaveBeenCalledWith('member', 'cancel'))
    expect(mocks.verifyEmail).toHaveBeenCalledWith({ memberName: 'Member', email: 'new@example.com' })
  })

  it('does not offer unsafe cancellation after a confirmation link was issued', () => {
    mocks.user.emailChange = { status: 'awaiting-verification', email: 'new@example.com' }
    render(<Profile />)
    expect(screen.getByText('profile.emailSync.awaitingTitle')).toBeTruthy()
    expect(screen.getByText('profile.emailSync.issuedLinkNotice')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /profile.emailSync.resend$/ })).toBeNull()
    const cancel = screen.getByRole('button', { name: /profile.emailSync.cancel$/ }) as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    expect(cancel.getAttribute('aria-describedby')).toBe('email-cancel-reason')
    expect(screen.getByText('profile.emailSync.legacyPending')).toBeTruthy()
    fireEvent.click(cancel)
    expect(mocks.verifyEmail).not.toHaveBeenCalled()
    expect(mocks.email).not.toHaveBeenCalled()
  })

  it('shows synchronization pending without offering email delivery or cancellation', () => {
    mocks.user.emailChange = { status: 'sync-pending', email: 'new@example.com' }
    render(<Profile />)
    expect(screen.getByText('profile.emailSync.syncTitle')).toBeTruthy()
    expect(screen.getByRole('button', { name: /profile.emailSync.retry$/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /profile.emailSync.send$/ })).toBeNull()
    expect((screen.getByRole('button', { name: /profile.emailSync.cancel$/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('profile.emailSync.cancelSyncPending')).toBeTruthy()
  })

  it('offers cancellation for a sent revocable request', async () => {
    mocks.user.emailChange = { status: 'awaiting-verification', email: 'new@example.com', proofVersion: 1 }
    render(<Profile />)
    expect(screen.getByText('profile.emailSync.revocableNotice')).toBeTruthy()
    expect(screen.getByRole('button', { name: /profile.emailSync.resend$/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /profile.emailSync.cancel$/ }))
    await waitFor(() => expect(mocks.email).toHaveBeenCalledWith('member', 'cancel'))
  })

  it('clears the proof from the address bar and requires an explicit verified confirmation', async () => {
    window.history.replaceState(null, '', '/profile#email-change=request&email-token=secret')
    mocks.user.emailChange = { id: 'request', status: 'awaiting-verification', email: 'new@example.com', proofVersion: 1 }
    render(<Profile />)
    expect(window.location.hash).toBe('')
    expect(mocks.email).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /profile.emailSync.confirmNewEmail$/ }))
    await waitFor(() => expect(mocks.email).toHaveBeenCalledWith('member', 'confirm', undefined, { changeId: 'request', confirmationToken: 'secret' }))
    expect(mocks.verifyEmail).toHaveBeenCalled()
  })
})
