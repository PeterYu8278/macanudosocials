import { describe, expect, it } from 'vitest'
import { maskEmail, messageText, normalizeWhatsAppSender, validateRegistrationEmail } from '../functions/_shared/whatsappRegistration'

describe('WhatsApp registration helpers', () => {
  it('accepts only direct Malaysian WhatsApp senders', () => {
    expect(normalizeWhatsAppSender('60123456789@s.whatsapp.net', '')).toBe('+60123456789')
    expect(normalizeWhatsAppSender('120363@g.us', '')).toBeNull()
    expect(normalizeWhatsAppSender('', 'not-a-phone')).toBeNull()
  })

  it('normalizes the case-insensitive registration inputs without storing message content', () => {
    expect(messageText({ text: { body: '  /REGISTER  ' } })).toBe('/REGISTER')
    expect(validateRegistrationEmail(' User@Example.com ')).toBe('user@example.com')
    expect(maskEmail('user@example.com')).toBe('u***@example.com')
  })
})
