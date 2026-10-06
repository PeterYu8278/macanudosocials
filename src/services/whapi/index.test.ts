// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../api/whatsapp', () => ({ whatsappRequest: mocks.request }));
vi.mock('../../config/firebase', () => ({ db: {} }));
vi.mock('../firebase/appConfig', () => ({ getAppConfig: vi.fn() }));
import { sendTextMessage } from './index';

describe('WhatsApp submission results', () => {
  beforeEach(() => vi.resetAllMocks());
  it.each(['accepted', 'sent', 'delivered', 'read'])('treats %s as a successful submission', async status => {
    mocks.request.mockResolvedValue({ status, messageId: 'provider-id' });
    expect(await sendTextMessage('0168008000', 'Test', 'member', 'Member', 'event_reminder'))
      .toEqual({ success: true, messageId: 'provider-id' });
  });
  it.each(['failed', 'unknown', 'submitting', 'opened'])('does not claim automated success for %s', async status => {
    mocks.request.mockResolvedValue({ status });
    expect(await sendTextMessage('0168008000', 'Test', 'member')).toMatchObject({ success: false, error: status });
  });
  it('keeps the request key stable for repeats without automatically retrying', async () => {
    mocks.request.mockResolvedValue({ status: 'unknown' });
    await sendTextMessage('0168008000', 'Test', 'member', 'Member', 'vip_expiry');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    await sendTextMessage('0168008000', 'Test', 'member', 'Member', 'vip_expiry');
    expect(mocks.request.mock.calls[1][1].requestId).toBe(mocks.request.mock.calls[0][1].requestId);
    expect(mocks.request.mock.calls[0][1].kind).toBe('vip_expiry');
  });
});
