// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User, UserRole } from '../../types'
import { canAccessRoute } from '../../config/permissions'

vi.mock('../../services/firebase/auth', () => ({
  onAuthStateChange: vi.fn(), getUserData: vi.fn(), convertFirestoreTimestamps: vi.fn(),
  findUserByEmail: vi.fn(), createMissingUserDocument: vi.fn(),
}))
vi.mock('../../config/firebase', () => ({ db: {} }))

import { useAuthStore } from './auth'

const developer = { id: 'dev', role: 'developer', displayName: 'Developer' } as User

describe('developer role simulation', () => {
  beforeEach(() => {
    useAuthStore.getState().logout()
    sessionStorage.clear()
  })

  it.each(['guest', 'member', 'vip', 'storeAdmin', 'admin', 'superAdmin'] as UserRole[])(
    'uses %s permissions without changing the real or cached role', role => {
      useAuthStore.getState().setUser(developer)
      useAuthStore.getState().setSimulatedRole(role)
      const state = useAuthStore.getState()
      expect(state.user?.role).toBe(role)
      expect(state.actualUser?.role).toBe('developer')
      expect(JSON.parse(sessionStorage.getItem('auth_userData')!).role).toBe('developer')
      expect(state.isDeveloper).toBe(false)
      expect(state.isSuperAdmin).toBe(role === 'superAdmin')
      expect(state.isAdmin).toBe(['storeAdmin', 'admin', 'superAdmin'].includes(role))
      expect(state.hasPermission('canViewFinance')).toBe(role === 'superAdmin')
      expect(state.hasPermission('canManageUsers')).toBe(['admin', 'superAdmin'].includes(role))
      expect(canAccessRoute(state.user!.role, '/admin')).toBe(['admin', 'superAdmin'].includes(role))
      expect(canAccessRoute(state.user!.role, '/admin/points-config')).toBe(
        ['storeAdmin', 'admin', 'superAdmin'].includes(role),
      )
    },
  )

  it('preserves simulation on real account updates and restores the latest data', () => {
    useAuthStore.getState().setUser(developer)
    useAuthStore.getState().setSimulatedRole('member')
    useAuthStore.getState().setUser({ ...developer, displayName: 'Updated' })
    expect(useAuthStore.getState().user?.role).toBe('member')
    useAuthStore.getState().setSimulatedRole(null)
    expect(useAuthStore.getState().user?.displayName).toBe('Updated')
    expect(useAuthStore.getState().isDeveloper).toBe(true)
  })

  it('rejects simulation for non-developers and clears it after account changes', () => {
    useAuthStore.getState().setUser(developer)
    useAuthStore.getState().setSimulatedRole('member')
    useAuthStore.getState().setUser({ id: 'member', role: 'member' } as User)
    useAuthStore.getState().setSimulatedRole('developer')
    expect(useAuthStore.getState().simulatedRole).toBeNull()
    expect(useAuthStore.getState().user?.role).toBe('member')
  })

  it('clears real identity and all privileges on logout', () => {
    useAuthStore.getState().setUser(developer)
    useAuthStore.getState().setSimulatedRole('superAdmin')
    useAuthStore.getState().logout()
    const state = useAuthStore.getState()
    expect(state.actualUser).toBeNull()
    expect(state.simulatedRole).toBeNull()
    expect(state.isSuperAdmin).toBe(false)
    expect(state.isAdmin).toBe(false)
    expect(state.isDeveloper).toBe(false)
  })

  it('keeps optimistic profile edits from caching the simulated role', () => {
    useAuthStore.getState().setUser(developer)
    useAuthStore.getState().setSimulatedRole('member')
    useAuthStore.getState().setUser({ ...useAuthStore.getState().user!, displayName: 'Edited' })
    expect(useAuthStore.getState().user?.role).toBe('member')
    expect(useAuthStore.getState().actualUser?.role).toBe('developer')
    expect(JSON.parse(sessionStorage.getItem('auth_userData')!).role).toBe('developer')
  })

  it('revokes simulation when the server removes developer privileges', () => {
    useAuthStore.getState().setUser(developer)
    useAuthStore.getState().setSimulatedRole('member')
    useAuthStore.getState().setUser({ ...developer, role: 'member' }, true)
    expect(useAuthStore.getState().actualUser?.role).toBe('member')
    expect(useAuthStore.getState().simulatedRole).toBeNull()
    useAuthStore.getState().setSimulatedRole('superAdmin')
    expect(useAuthStore.getState().user?.role).toBe('member')
  })
})
