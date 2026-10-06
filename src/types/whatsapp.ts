export type WhatsAppProvider = 'manual' | 'whapi' | 'whatsmeow' | 'waba'
export type WhatsAppKind = 'custom' | 'event_reminder' | 'vip_expiry' | 'password_reset'
export interface WhatsAppSettings {
  enabled: boolean
  defaultProvider: WhatsAppProvider
  features: { eventReminder: boolean; vipExpiry: boolean; passwordReset: boolean }
  whapi: { channelId: string }
  whatsmeow: { baseUrl: string; phone: string }
  waba: { wabaId: string; phoneNumberId: string; phone: string }
  testPhones: string[]
}
export interface WhatsAppManagementState {
  config: WhatsAppSettings
  whapiCredentials: boolean
  whapiVerified: boolean
}
export const defaultWhatsAppSettings: WhatsAppSettings = {
  enabled: false, defaultProvider: 'manual',
  features: { eventReminder: false, vipExpiry: false, passwordReset: false },
  whapi: { channelId: '' }, whatsmeow: { baseUrl: '', phone: '' },
  waba: { wabaId: '', phoneNumberId: '', phone: '' }, testPhones: [],
}
