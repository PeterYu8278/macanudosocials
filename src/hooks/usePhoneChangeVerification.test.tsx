import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ popup: vi.fn(), password: vi.fn(), credential: vi.fn(), token: vi.fn(), completed: vi.fn(), auth: { currentUser: null as any } }))
vi.mock('../config/firebase', () => ({ auth: mocks.auth }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {}, EmailAuthProvider: { credential: mocks.credential },
  reauthenticateWithPopup: mocks.popup, reauthenticateWithCredential: mocks.password,
}))
import { usePhoneChangeVerification } from './usePhoneChangeVerification'
const Harness = () => {
  const { verifyPhoneChange, phoneVerificationModal } = usePhoneChangeVerification()
  return <><button onClick={() => { void verifyPhoneChange().then(mocks.completed) }}>Request</button>{phoneVerificationModal}</>
}
describe('phone change verification', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.currentUser = { email: 'member@example.com', providerData: [{ providerId: 'password' }, { providerId: 'google.com' }], getIdToken: mocks.token }
    Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }) })
  })
  afterEach(() => cleanup())
  it('reauthenticates the existing user with Google and refreshes the token', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Request'))
    fireEvent.click(await screen.findByText('profile.phoneSync.verifyGoogle'))
    await waitFor(() => expect(mocks.completed).toHaveBeenCalledWith(true))
    expect(mocks.popup.mock.calls[0][0]).toBe(mocks.auth.currentUser)
    expect(mocks.token).toHaveBeenCalledWith(true)
    expect(mocks.password).not.toHaveBeenCalled()
  })
  it('checks the current account password before resolving verification', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Request'))
    const input = await screen.findByLabelText('profile.currentPassword')
    fireEvent.change(input, { target: { value: 'test-password' } })
    fireEvent.click(screen.getByText('profile.phoneSync.verifyPassword'))
    await waitFor(() => expect(mocks.completed).toHaveBeenCalledWith(true))
    expect(mocks.credential).toHaveBeenCalledWith('member@example.com', 'test-password')
    expect(mocks.password.mock.calls[0][0]).toBe(mocks.auth.currentUser)
  })
  it('cancels verification without an authentication call', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Request'))
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))
    await waitFor(() => expect(mocks.completed).toHaveBeenCalledWith(false))
    expect(mocks.popup).not.toHaveBeenCalled()
    expect(mocks.password).not.toHaveBeenCalled()
  })
  it('cancels an outstanding verification when the profile is unmounted', async () => {
    const view = render(<Harness />)
    fireEvent.click(screen.getByText('Request'))
    await act(async () => view.unmount())
    expect(mocks.completed).toHaveBeenCalledWith(false)
  })
})
