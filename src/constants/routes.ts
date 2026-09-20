/**
 * 路由路径常量
 */

// 认证路由
export const AUTH_ROUTES = {
  LOGIN: '/',
  REGISTER: '/register',
  FORGOT_PASSWORD: '/forgot-password',
  RESET_PASSWORD: '/reset-password'
} as const

// 前台路由
export const FRONTEND_ROUTES = {
  HOME: '/',
  SHOP: '/shop',
  EVENTS: '/events',
  PROFILE: '/profile',
  MY_ORDERS: '/my-orders',
  PAYMENT_RESULT: '/payment/result'
} as const

// 后台路由
export const ADMIN_ROUTES = {
  DASHBOARD: '/admin',
  USERS: '/admin/users',
  INVENTORY: '/admin/inventory',
  ORDERS: '/admin/orders',
  TRANSACTIONS: '/admin/transactions',
  EVENTS: '/admin/events',
  SETTINGS: '/admin/settings'
} as const

// 开发者路由
export const DEVELOPER_ROUTES = {
  FEATURE_MANAGEMENT: '/developer/feature-management',
  CIGAR_DATABASE: '/developer/cigar-database',
  PERFORMANCE: '/developer/performance',
  GEMINI_TESTER: '/developer/gemini-tester',
  CLOUDINARY_TEST: '/developer/cloudinary-test',
  ORPHANED_USERS: '/developer/orphaned-users',
  DEBUG_ORDERS: '/developer/debug-orders',
  TEST_DATA_GENERATOR: '/developer/test-data-generator'
} as const

// 所有路由
export const ROUTES = {
  ...AUTH_ROUTES,
  ...FRONTEND_ROUTES,
  ...ADMIN_ROUTES,
  ...DEVELOPER_ROUTES
} as const

export type RouteKey = keyof typeof ROUTES
export type RoutePath = typeof ROUTES[RouteKey]

