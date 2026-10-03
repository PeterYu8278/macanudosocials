import { describe, expect, it } from 'vitest'
import { getStatusColor, getStatusText, getOrderNoteText, getOrderAddressText } from './helpers'

describe('completed order display', () => {
  const t = (key: string) => key

  it('preserves the display for existing unmarked orders', () => {
    expect(getStatusText('completed', t)).toBe('profile.unknown')
    expect(getStatusColor('completed')).toBe('default')
  })

  it('shows completed for newly created marked orders', () => {
    expect(getStatusText('completed', t, true)).toBe('ordersAdmin.status.completed')
    expect(getStatusColor('completed', true)).toBe('green')
  })

  it('keeps other order statuses independent of the marker', () => {
    expect(getStatusText('delivered', t)).toBe('ordersAdmin.status.delivered')
    expect(getStatusColor('delivered')).toBe('green')
  })
})

describe('generated order text localization', () => {
  const t = (key: string, options?: Record<string, string>) => {
    if (key === 'ordersAdmin.loungeRedemptionNote') return `Lounge redemption order (Session: ${options?.sessionId})`
    if (key === 'ordersAdmin.loungeRedemptionAddress') return 'Lounge redemption'
    return key
  }

  it('localizes legacy notes while preserving the session ID and historical marker', () => {
    expect(getOrderNoteText('驻店兑换订单 (Session: legacy_123) (H)', t))
      .toBe('Lounge redemption order (Session: legacy_123) (H)')
    expect(getOrderNoteText('驻店兑换订单 (Session: visit_123)', t))
      .toBe('Lounge redemption order (Session: visit_123)')
  })

  it('preserves custom notes and real shipping addresses', () => {
    expect(getOrderNoteText('Customer pickup requested', t)).toBe('Customer pickup requested')
    expect(getOrderAddressText('123 Main Street', t)).toBe('123 Main Street')
    expect(getOrderAddressText('会所兑换', t)).toBe('Lounge redemption')
  })
})
