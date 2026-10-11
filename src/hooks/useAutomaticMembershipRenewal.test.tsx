// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { StrictMode } from 'react';

const m = vi.hoisted(() => ({ state: {} as any, quote: vi.fn(), activate: vi.fn(), refresh: vi.fn(), setUser: vi.fn() }));
vi.mock('../store/modules/auth', () => ({ useAuthStore: () => m.state }));
vi.mock('../services/membershipActivation', () => ({ getMembershipPaymentQuote: m.quote, activateMembership: m.activate }));
vi.mock('../services/firebase/auth', () => ({ getUserData: m.refresh }));
import { useAutomaticMembershipRenewal } from './useAutomaticMembershipRenewal';

describe('automatic Annual Pass renewal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.state = { user: { id: 'member', status: 'inactive', membership: { points: 102 } }, loading: false, setUser: m.setUser };
    m.quote.mockResolvedValue({ renewal: true, annualFee: 199 });
    m.activate.mockResolvedValue({ success: true });
    m.refresh.mockResolvedValue({ id: 'member', status: 'active', membership: { points: 3 } });
  });
  afterEach(cleanup);

  it('automatically renews when a reload raises the balance to the annual fee', async () => {
    const { rerender } = renderHook(() => useAutomaticMembershipRenewal());
    await waitFor(() => expect(m.quote).toHaveBeenCalledTimes(1));
    expect(m.activate).not.toHaveBeenCalled();
    m.state = { ...m.state, user: { ...m.state.user, membership: { points: 202 } } };
    rerender();
    await waitFor(() => expect(m.setUser).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' })));
    expect(m.activate).toHaveBeenCalledTimes(1);
  });

  it('renews on initial load when sufficient points already exist', async () => {
    m.state.user.membership.points = 199;
    renderHook(() => useAutomaticMembershipRenewal());
    await waitFor(() => expect(m.activate).toHaveBeenCalledTimes(1));
  });
  it('refreshes a restored membership without submitting another debit', async () => {
    m.state.user.membership.points = 500;
    m.quote.mockResolvedValue({ renewal: true, annualFee: 199, accountStatus: 'active' });
    renderHook(() => useAutomaticMembershipRenewal());
    await waitFor(() => expect(m.setUser).toHaveBeenCalledTimes(1));
    expect(m.activate).not.toHaveBeenCalled();
  });

  it('submits once when React Strict Mode repeats effect initialization', async () => {
    m.state.user.membership.points = 202;
    renderHook(() => useAutomaticMembershipRenewal(), { wrapper: StrictMode });
    await waitFor(() => expect(m.setUser).toHaveBeenCalledTimes(1));
    expect(m.activate).toHaveBeenCalledTimes(1);
  });

  it.each([{ renewal: false, annualFee: 199 }, { renewal: true, annualFee: 199, pending: true }])('does not debit first activation or an existing payment', async quote => {
    m.state.user.membership.points = 500;
    m.quote.mockResolvedValue(quote);
    renderHook(() => useAutomaticMembershipRenewal());
    await act(async () => {});
    expect(m.activate).not.toHaveBeenCalled();
  });

  it.each(['active', 'suspended'])('does not renew an %s account', async status => {
    m.state.user.status = status;
    renderHook(() => useAutomaticMembershipRenewal());
    await act(async () => {});
    expect(m.quote).not.toHaveBeenCalled();
  });

  it('does not loop after a failed debit with an unchanged balance', async () => {
    m.state.user.membership.points = 202;
    m.activate.mockResolvedValue({ success: false, code: 'INSUFFICIENT_POINTS' });
    const { rerender } = renderHook(() => useAutomaticMembershipRenewal());
    await waitFor(() => expect(m.activate).toHaveBeenCalledTimes(1));
    rerender();
    await act(async () => {});
    expect(m.activate).toHaveBeenCalledTimes(1);
    expect(m.setUser).not.toHaveBeenCalled();
  });

  it('does not debit after signing out during the eligibility check', async () => {
    let resolve!: (value: any) => void;
    m.state.user.membership.points = 202;
    m.quote.mockReturnValue(new Promise(done => { resolve = done; }));
    const { rerender } = renderHook(() => useAutomaticMembershipRenewal());
    m.state = { ...m.state, user: null };
    rerender();
    await act(async () => { resolve({ renewal: true, annualFee: 199 }); });
    expect(m.activate).not.toHaveBeenCalled();
  });
});
