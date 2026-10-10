// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitWhapi, submitWhapiButtons, submitWhapiQuickReply, submitWhapiUrlButton } from '../functions/_shared/whatsapp';

describe('Outgoing WhatsApp messages', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(['text', 'confirmation', 'restart', 'link'])('brands %s messages while preserving destinations and buttons', async kind => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'message' }) });
    vi.stubGlobal('fetch', fetch);
    if (kind === 'text') await submitWhapi('test-token', '+60123456789', 'Hello');
    else if (kind === 'confirmation') await submitWhapiButtons('test-token', '+60123456789', 'Hello');
    else if (kind === 'restart') await submitWhapiQuickReply('test-token', '+60123456789', 'Hello', 'To start again', 'register_start');
    else await submitWhapiUrlButton('test-token', '+60123456789', 'Hello', 'Login now', 'https://example.com/?open=login');
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.to).toBe('60123456789');
    expect(kind === 'text' ? payload.body : payload.body.text).toBe('[Macanudo Socials]\nHello');
    if (kind === 'confirmation') expect(payload.action.buttons.map((button: any) => button.title)).toEqual(['Confirm', 'Cancel']);
    if (kind === 'restart') expect(payload.action.buttons[0].id).toBe('register_start');
    if (kind === 'link') expect(payload.action.buttons[0].url).toBe('https://example.com/?open=login');
  });
});
