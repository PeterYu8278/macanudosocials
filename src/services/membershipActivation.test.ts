import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ token: vi.fn() }));
vi.mock('../config/firebase', () => ({ auth: { currentUser: { getIdToken: m.token } } }));
import { createMembershipPayment, getMembershipPaymentQuote } from './membershipActivation';

describe('membership payment request deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    m.token.mockResolvedValue('test-token');
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('returns a successful response and clears the timeout', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, paymentUrl: 'https://test/bill' })));
    vi.stubGlobal('fetch', fetch);
    expect(await createMembershipPayment(100, 'store')).toMatchObject({ paymentUrl: 'https://test/bill' });
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('aborts a stalled request without automatically retrying a payment', async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetch);
    const result = createMembershipPayment(100, 'store');
    const failure = expect(result).rejects.toThrow('PAYMENT_TIMEOUT');
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not submit a late payment after token retrieval times out', async () => {
    let resolve!: (token: string) => void;
    m.token.mockReturnValue(new Promise<string>(done => { resolve = done; }));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const failure = expect(createMembershipPayment(100, 'store')).rejects.toThrow('PAYMENT_TIMEOUT');
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    resolve('late-token');
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('also bounds a stalled quote response body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => {}) }));
    const failure = expect(getMembershipPaymentQuote()).rejects.toThrow('PAYMENT_TIMEOUT');
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
  });
  it('preserves the backend error and clears its timer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false, code: 'PAYMENT_CREATING' }), { status: 409 })));
    await expect(createMembershipPayment(100, 'store')).rejects.toThrow('PAYMENT_CREATING');
    expect(vi.getTimerCount()).toBe(0);
  });
});
