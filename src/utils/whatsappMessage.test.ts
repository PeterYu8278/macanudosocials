import { describe, expect, it } from 'vitest';
import { formatWhatsAppMessage } from './whatsappMessage';

describe('WhatsApp brand header', () => {
  it('adds the exact header and a newline without changing the body', () => {
    expect(formatWhatsAppMessage('Hello\nName: Peter')).toBe('[Macanudo Socials]\nHello\nName: Peter');
  });
  it('does not duplicate an existing header', () => {
    const message = '[Macanudo Socials]\nHello';
    expect(formatWhatsAppMessage(message)).toBe(message);
    expect(formatWhatsAppMessage('[Macanudo Socials] Hello')).toBe(message);
    expect(formatWhatsAppMessage('[Macanudo Socials]\r\nHello')).toBe(message);
  });
});
