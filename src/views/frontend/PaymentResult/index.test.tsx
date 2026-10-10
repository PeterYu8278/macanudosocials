// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ params: new URLSearchParams('membershipOrder=order&paid=true'), status: vi.fn(), navigate: vi.fn(), setUser: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => m.navigate, useSearchParams: () => [m.params] }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../services/membershipActivation', () => ({ getMembershipPaymentStatus: m.status }));
vi.mock('../../../store/modules/auth', () => ({ useAuthStore: () => ({ user: null, setUser: m.setUser }) }));
vi.mock('../../../services/firebase/auth', () => ({ getUserData: vi.fn() }));
vi.mock('antd', () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  Spin: () => <div>loading</div>,
  Typography: { Title: ({ children }: any) => <h2>{children}</h2>, Text: ({ children }: any) => <span>{children}</span> },
}));
vi.mock('@ant-design/icons', () => ({ CheckCircleOutlined: () => null, CloseCircleOutlined: () => null, LoadingOutlined: () => null }));
import PaymentResult from './index';

describe('Annual Pass payment result', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); m.params = new URLSearchParams('membershipOrder=order&paid=true');
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it('does not report success based on an untrusted paid=true parameter', async () => {
    m.status.mockResolvedValue({ status: 'pending' });
    await act(async () => { render(<PaymentResult />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(screen.getByText('annualPassPayment.pendingTitle')).toBeTruthy();
    expect(screen.queryByText('payment.successTitle')).toBeNull();
  });
  it('reports activated membership only after server fulfillment', async () => {
    m.status.mockResolvedValue({ status: 'fulfilled' });
    await act(async () => { render(<PaymentResult />); });
    expect(screen.getByText('annualPassPayment.successDescription')).toBeTruthy();
  });
  it('distinguishes credit-only processing from successful activation', async () => {
    m.status.mockResolvedValue({ status: 'credited' });
    await act(async () => { render(<PaymentResult />); });
    expect(screen.getByText('annualPassPayment.creditedTitle')).toBeTruthy();
  });
});
