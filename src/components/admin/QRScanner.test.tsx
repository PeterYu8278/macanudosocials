import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  records: vi.fn(), stores: vi.fn(),
  t: (key: string) => key,
  message: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
  member: { id: 'member', displayName: 'Alice', role: 'member', membership: { points: 200 }, profile: {} },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t, i18n: { language: 'en-US' } }) }))
vi.mock('antd', async original => ({ ...(await original<any>()), App: { useApp: () => ({ message: mocks.message }) } }))
vi.mock('html5-qrcode', () => ({ Html5Qrcode: class {
  isScanning = false
  start = vi.fn().mockResolvedValue(undefined)
  stop = vi.fn().mockResolvedValue(undefined)
  clear = vi.fn()
} }))
vi.mock('../../store/modules/auth', () => ({ useAuthStore: () => ({ user: { id: 'admin' } }) }))
vi.mock('../../services/firebase/stores', () => ({ getActiveStores: mocks.stores }))
vi.mock('../../utils/memberId', () => ({ getUserByMemberId: async () => ({ success: true, user: mocks.member }) }))
vi.mock('../../services/firebase/firestore', () => ({
  getUserById: async () => mocks.member,
  getCigars: async () => [{ id: 'cigar', name: 'Robusto', price: 20 }],
}))
vi.mock('../../services/firebase/membershipFee', () => ({ getCurrentHourlyRate: async () => 10 }))
vi.mock('../../services/firebase/redemption', () => ({
  getRedemptionRecordsBySession: mocks.records, createRedemptionRecord: vi.fn(), updateRedemptionRecord: vi.fn(),
}))
vi.mock('../../services/firebase/visitSessions', () => ({
  calculateVisitDuration: () => 0.5,
  createVisitSession: vi.fn(), completeVisitSession: vi.fn(),
  getPendingVisitSession: async () => ({ id: 'visit', storeId: 'lounge', checkInAt: new Date(), redemptions: [] }),
}))
import { QRScannerView } from './QRScanner'

describe('scanner checkout cigar selection', () => {
  beforeEach(() => {
    mocks.records.mockReset().mockResolvedValue([])
    mocks.stores.mockResolvedValue([{ id: 'lounge', name: 'Lounge A' }])
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })
  })
  afterEach(cleanup)

  async function scanMember() {
    render(<QRScannerView active />)
    await screen.findByText('Lounge A')
    fireEvent.change(screen.getByPlaceholderText('scanner.memberIdPlaceholder'), { target: { value: 'ABC123' } })
    fireEvent.click(screen.getByText('scanner.findMember'))
    await screen.findByText('scanner.confirmCheckout')
    await waitFor(() => expect(mocks.records).toHaveBeenCalledWith('visit'))
  }

  it('hides the cigar selector when the visit has no redemption records', async () => {
    await scanMember()
    await screen.findByText('scanner.noVisitCigarSet')
    expect(screen.queryByText('visitSessions.selectCigar')).toBeNull()
    expect(screen.queryByText('common.save')).toBeNull()
  }, 15000)

  it('shows the selector for an existing pending redemption', async () => {
    mocks.records.mockResolvedValue([{ id: 'pending', status: 'pending', cigarId: '', quantity: 1 }])
    await scanMember()
    expect(await screen.findByText('visitSessions.selectCigar')).toBeTruthy()
    expect(screen.getByText('common.save')).toBeTruthy()
  })

  it('shows completed redemptions without offering a new cigar selection', async () => {
    mocks.records.mockResolvedValue([{ id: 'done', status: 'completed', cigarId: 'cigar', cigarName: 'Robusto', quantity: 2 }])
    await scanMember()
    expect(await screen.findByText('Robusto')).toBeTruthy()
    expect(screen.queryByText('visitSessions.selectCigar')).toBeNull()
  })
})
