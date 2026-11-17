import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVisitSummary } from './useVisitSummary'
const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../../../services/firebase/dashboardVisitStats', () => ({ getDashboardVisitSummary: mocks.read }))
const result = (count: number) => ({ status: 'ready', evaluatedAt: new Date(), counts: { daily: count },
  occupancy: { status: 'ready', hours24: Array(24).fill(count), days7: Array(7).fill(count), asOf: new Date() } })

describe('Dashboard summary lifecycle', () => {
  beforeEach(() => mocks.read.mockReset())
  afterEach(cleanup)
  it('does not read global summaries for an operator without an assigned store', () => {
    const { result: state } = renderHook(() => useVisitSummary('operator', false))
    expect(mocks.read).not.toHaveBeenCalled()
    expect(state.current.data).toBeNull()
    expect(state.current.loading).toBe(false)
  })
  it('ignores an old request after a store change', async () => {
    let resolveOld: (value: any) => void = () => {}
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValueOnce(result(2))
    const { result: state, rerender } = renderHook(({ store }) => useVisitSummary('operator', false, store), { initialProps: { store: 'a' } })
    rerender({ store: 'b' })
    await waitFor(() => expect(state.current.data?.counts.daily).toBe(2))
    await act(async () => resolveOld(result(1)))
    expect(state.current.data?.counts.daily).toBe(2)
    expect(mocks.read.mock.calls.map(([scope]) => scope)).toEqual(['a', 'b'])
  })
  it('clears previous statistics when a refreshed server read fails', async () => {
    mocks.read.mockResolvedValueOnce(result(1)).mockRejectedValueOnce(new Error('offline'))
    const { result: state } = renderHook(() => useVisitSummary('operator', false, 'a'))
    await waitFor(() => expect(state.current.data?.status).toBe('ready'))
    act(() => state.current.refresh())
    await waitFor(() => expect(state.current.loading).toBe(false))
    expect(state.current.data).toBeNull()
  })
})
