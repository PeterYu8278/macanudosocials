import { describe, expect, it } from 'vitest'
import { getLoginLandingPath } from './loginLanding'
import { canAccessRoute } from '../config/permissions'
import type { UserRole } from '../types'

describe('login landing route', () => {
  it.each<UserRole>(['developer', 'admin', 'superAdmin', 'storeAdmin'])('lands %s on an accessible dashboard', role => {
    expect(getLoginLandingPath(role)).toBe('/admin')
    expect(canAccessRoute(role, '/admin')).toBe(true)
  })

  it.each<UserRole>(['guest', 'member', 'vip'])('keeps %s on the member homepage', role => {
    expect(getLoginLandingPath(role)).toBe('/')
    expect(canAccessRoute(role, '/admin')).toBe(false)
  })

  it('keeps lounge-admin permissions limited to the requested dashboard', () => {
    expect(canAccessRoute('storeAdmin', '/admin/users')).toBe(false)
    expect(canAccessRoute('storeAdmin', '/admin/finance')).toBe(false)
    expect(canAccessRoute('storeAdmin', '/admin/points-config')).toBe(true)
  })
})
