import type { UserRole } from '../types'

export const getLoginLandingPath = (role?: UserRole, fallback = '/') =>
  role && ['developer', 'superAdmin', 'admin', 'storeAdmin'].includes(role) ? '/admin' : fallback
