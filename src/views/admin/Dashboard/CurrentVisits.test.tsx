import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisitSession } from '../../../types'
import CurrentVisits from './CurrentVisits'

const mocks = vi.hoisted(() => ({
  auth: { user: { id: 'admin', storeId: 'lounge-a', role: 'admin' }, isSuperAdmin: false },
  listen: vi.fn(),
  readRecords: vi.fn(),
  listenRecords: vi.fn(),
  unsubscribe: vi.fn(),
}))

vi.mock('../../../store/modules/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('../../../hooks/useFirestoreQuery', () => ({ useFirestoreQuery: () => ({ data: [{ id: 'lounge-a', name: 'Lounge A' }] }) }))
vi.mock('../../../services/firebase/stores', () => ({ getAllStores: vi.fn() }))
vi.mock('../../../services/firebase/visitSessions', () => ({ subscribeToPendingVisitSessions: mocks.listen }))
vi.mock('../../../services/firebase/redemption', () => ({
  getRedemptionRecordsBySession: mocks.readRecords,
  subscribeToRedemptionRecordsBySession: mocks.listenRecords,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('current lounge visits', () => {
  beforeEach(() => {
    mocks.auth.isSuperAdmin = false
    mocks.auth.user = { id: 'admin', storeId: 'lounge-a', role: 'admin' }
    mocks.listen.mockReset().mockReturnValue(mocks.unsubscribe)
    mocks.unsubscribe.mockReset()
    mocks.readRecords.mockReset().mockResolvedValue([
      { id: 'redeemed', cigarId: 'cigar-a', cigarName: 'Old name', quantity: 2, status: 'completed' },
      { id: 'waiting', cigarId: '', cigarName: '', quantity: 1, status: 'pending' },
    ])
    mocks.listenRecords.mockReset().mockImplementation((_id, callback) => {
      callback()
      return vi.fn()
    })
    window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('scopes the listener and updates members and cigar records as visits change', async () => {
    render(<MemoryRouter><CurrentVisits users={[]} cigars={[{ id: 'cigar-a', name: 'Robusto' } as any]} /></MemoryRouter>)
    expect(mocks.listen.mock.calls[0][0]).toBe('lounge-a')
    const onChange = mocks.listen.mock.calls[0][1]
    act(() => onChange([{ id: 'visit-a', userId: 'member-a', userName: 'Alice', storeId: 'lounge-a', checkInAt: new Date(), status: 'pending' } as VisitSession]))
    await waitFor(() => expect(screen.getByText('Robusto')).toBeTruthy())
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('x2')).toBeTruthy()
    expect(screen.getAllByText('visitSessions.statusToSelect').length).toBeGreaterThan(0)
    act(() => onChange([]))
    expect(screen.queryByText('Alice')).toBeNull()
    expect(screen.getByText('dashboard.noCurrentVisits')).toBeTruthy()
  })

  it('does not subscribe across stores when an administrator has no assigned lounge', () => {
    mocks.auth.user.storeId = ''
    render(<MemoryRouter><CurrentVisits users={[]} cigars={[]} /></MemoryRouter>)
    expect(mocks.listen).not.toHaveBeenCalled()
  })

  it('uses the compact empty-redemption layout and minute-only duration for short visits', async () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    mocks.readRecords.mockResolvedValue([])
    render(<MemoryRouter><CurrentVisits users={[]} cigars={[]} /></MemoryRouter>)
    act(() => mocks.listen.mock.calls[0][1]([{ id: 'visit', userName: 'Alice', checkInAt: new Date(now - 4 * 60000) }]))
    const empty = await screen.findByText('visitSessions.noRedemptionRecords')
    expect(empty.closest('.dashboard-current-visit')?.classList.contains('dashboard-current-visit--has-redemptions')).toBe(false)
    expect(screen.getByText('4m')).toBeTruthy()
  })
})
