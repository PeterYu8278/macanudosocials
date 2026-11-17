import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ token: vi.fn(), fetch: vi.fn() }));
vi.mock('../config/firebase', () => ({ auth: { currentUser: { getIdToken: mocks.token } } }));
vi.mock('../i18n', () => ({ default: { t: (key: string) => key, exists: () => true } }));
import { loungeRequest, managedCheckin } from './loungeOperations';

describe('lounge backend response handling', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.token.mockResolvedValue('test-token'); vi.stubGlobal('fetch', mocks.fetch); });
  afterEach(() => vi.unstubAllGlobals());
  it.each(['', '<html>Proxy error</html>', 'null', '[]', '{}', '{"success":"true"}'])('shows a useful backend error for invalid responses: %s', async body => {
    mocks.fetch.mockResolvedValue(new Response(body, { status: 500 }));
    await expect(loungeRequest('status', { storeId: 'lounge' })).rejects.toThrow('loungeOperations.errors.backend-unavailable');
  });
  it('handles connection failures without exposing raw browser errors', async () => {
    mocks.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(loungeRequest('status')).rejects.toThrow('loungeOperations.errors.backend-unavailable');
  });
  it('preserves meaningful API permission errors', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: false, code: 'forbidden' }), { status: 403 }));
    await expect(loungeRequest('status')).rejects.toThrow('loungeOperations.errors.forbidden');
  });
  it('accepts a successful response and sends the authenticated request', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ success: true, batches: [] }), { status: 200 }));
    expect(await loungeRequest('status', { storeId: 'lounge' })).toEqual({ success: true, batches: [] });
    expect(mocks.fetch).toHaveBeenCalledWith('/.netlify/functions/lounge-operations', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      body: JSON.stringify({ action: 'status', storeId: 'lounge' }),
    }));
  });
  it('retains the check-in idempotency key after an ambiguous empty response', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, sessionId: 'session' }), { status: 200 }));
    await expect(managedCheckin('member', 'lounge')).rejects.toThrow();
    expect((await managedCheckin('member', 'lounge')).sessionId).toBe('session');
    const first = JSON.parse(mocks.fetch.mock.calls[0][1].body), second = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(second.requestId).toBe(first.requestId);
  });
});
