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
  meowGateways?: string[]
  config: WhatsAppSettings
  whapiCredentials: boolean
  whapiVerified: boolean
  webhookConfigured?: boolean
  webhookLastReceivedAt?: string | null
  webhookUrl?: string | null
  whapiUserId?: string | null
  credentialSource?: string
  managed?: boolean
  encryptionReady?: boolean
  credentialsInvalid?: boolean
  connectionStatus?: string
  verifiedAt?: string | null
  connectionBusy?: boolean
  candidate?: WhatsAppCandidate | null
}
export interface WhatsAppCandidate {
  id: string; channelId: string; expiresAtMs: number; verified: boolean; account: string | null
}
export interface WhatsAppConnectionSession {
  id: string; target: 'active' | 'candidate'; channelId: string; expiresAtMs: number; status: string
}
export const defaultWhatsAppSettings: WhatsAppSettings = {
  enabled: false, defaultProvider: 'manual',
  features: { eventReminder: false, vipExpiry: false, passwordReset: false },
  whapi: { channelId: '' }, whatsmeow: { baseUrl: '', phone: '' },
  waba: { wabaId: '', phoneNumberId: '', phone: '' }, testPhones: [],
}
