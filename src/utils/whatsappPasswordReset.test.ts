import { describe, expect, it } from 'vitest';
import { passwordResetLinkMessage, temporaryPasswordMessage } from './whatsappPasswordReset';
import { formatWhatsAppMessage } from './whatsappMessage';

describe('English WhatsApp password recovery messages', () => {
  it('keeps automatic recovery in English and preserves the reset link', () => {
    expect(passwordResetLinkMessage('https://example.com/reset?code=abc')).toBe(
      '[Macanudo Socials]\nReset your password using this link:\nhttps://example.com/reset?code=abc\nIf you did not request this, ignore this message. Your password has not been changed.',
    );
  });

  it('keeps exactly one brand header after provider formatting', () => {
    const message = passwordResetLinkMessage('https://example.com/reset?code=abc');
    expect(formatWhatsAppMessage(message)).toBe(message);
    expect(formatWhatsAppMessage(message).match(/\[Macanudo Socials\]/g)).toHaveLength(1);
  });

  it('keeps manual recovery in English and preserves the brand, name and temporary password', () => {
    expect(temporaryPasswordMessage('Macanudo Socials', 'Atikah', 'Ab123xyz')).toBe(
      '[Macanudo Socials] Password Reset\nHello Atikah, your password has been reset.\n\nTemporary password: Ab123xyz\n\nPlease sign in and change your password as soon as possible. If you did not request this, contact an administrator immediately.',
    );
  });

  it('uses an English greeting fallback for a missing name', () => {
    expect(temporaryPasswordMessage('MS', undefined, 'Ab123xyz')).toContain('Hello member,');
    expect(temporaryPasswordMessage('MS', '', 'Ab123xyz')).toContain('Hello member,');
  });
});
