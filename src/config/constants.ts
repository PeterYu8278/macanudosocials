/**
 * 应用常量配置
 * 统一管理所有常量值
 */

// 应用信息
export const APP_INFO = {
  NAME: 'MS',
  VERSION: '1.0.0',
  DESCRIPTION: 'Macanudo Socials Management Platform',
  AUTHOR: 'JEP Ventures',
  WEBSITE: 'https://cigarclub.com',
  SUPPORT_EMAIL: 'support@cigarclub.com'
} as const

// 用户角色
export const USER_ROLES = {
  SUPER_ADMIN: 'superAdmin',
  ADMIN: 'admin',
  MEMBER: 'member',
  GUEST: 'guest',
  DEVELOPER: 'developer'
} as const

export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES]

// 会员等级
export const MEMBERSHIP_LEVELS = {
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD: 'gold',
  PLATINUM: 'platinum'
} as const

export type MembershipLevel = typeof MEMBERSHIP_LEVELS[keyof typeof MEMBERSHIP_LEVELS]

// 订单状态
export const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled'
} as const

export type OrderStatus = typeof ORDER_STATUS[keyof typeof ORDER_STATUS]

// 活动状态
export const EVENT_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed'
} as const

export type EventStatus = typeof EVENT_STATUS[keyof typeof EVENT_STATUS]

// 品牌状态
export const BRAND_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive'
} as const

export type BrandStatus = typeof BRAND_STATUS[keyof typeof BRAND_STATUS]

// 雪茄强度
export const CIGAR_STRENGTH = {
  MILD: 'mild',
  MEDIUM: 'medium',
  FULL: 'full'
} as const

export type CigarStrength = typeof CIGAR_STRENGTH[keyof typeof CIGAR_STRENGTH]

// 库存操作类型
export const INVENTORY_OPERATIONS = {
  IN: 'in',
  OUT: 'out',
  ADJUSTMENT: 'adjustment'
} as const

export type InventoryOperation = typeof INVENTORY_OPERATIONS[keyof typeof INVENTORY_OPERATIONS]

// 支付方式
export const PAYMENT_METHODS = {
  CREDIT_CARD: 'credit',
  PAYPAL: 'paypal',
  BANK_TRANSFER: 'bank_transfer',
  CASH: 'cash'
} as const

export type PaymentMethod = typeof PAYMENT_METHODS[keyof typeof PAYMENT_METHODS]

// 语言代码
export const LANGUAGES = {
  ZH_CN: 'zh-CN',
  EN_US: 'en-US'
} as const

export type Language = typeof LANGUAGES[keyof typeof LANGUAGES]

// 主题
export const THEMES = {
  DARK: 'dark',
  LIGHT: 'light'
} as const

export type Theme = typeof THEMES[keyof typeof THEMES]

// 文件类型
export const FILE_TYPES = {
  IMAGE: 'image',
  DOCUMENT: 'document',
  VIDEO: 'video',
  AUDIO: 'audio'
} as const

export type FileType = typeof FILE_TYPES[keyof typeof FILE_TYPES]

// 图片格式
export const IMAGE_FORMATS = {
  JPEG: 'jpeg',
  JPG: 'jpg',
  PNG: 'png',
  GIF: 'gif',
  WEBP: 'webp',
  SVG: 'svg'
} as const

export type ImageFormat = typeof IMAGE_FORMATS[keyof typeof IMAGE_FORMATS]

// 响应式断点
export const BREAKPOINTS = {
  XS: 480,
  SM: 576,
  MD: 768,
  LG: 992,
  XL: 1200,
  XXL: 1600
} as const

// 分页配置
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 10,
  PAGE_SIZE_OPTIONS: [10, 20, 50, 100],
  MAX_PAGE_SIZE: 1000
} as const

// 文件大小限制
export const FILE_SIZE_LIMITS = {
  IMAGE: 10 * 1024 * 1024, // 10MB
  DOCUMENT: 50 * 1024 * 1024, // 50MB
  VIDEO: 500 * 1024 * 1024, // 500MB
  AUDIO: 100 * 1024 * 1024 // 100MB
} as const

// 缓存配置
export const CACHE_CONFIG = {
  DEFAULT_TTL: 5 * 60 * 1000, // 5分钟
  LONG_TTL: 60 * 60 * 1000, // 1小时
  SHORT_TTL: 60 * 1000, // 1分钟
  MAX_ITEMS: 1000
} as const

// 本地存储键名
export const STORAGE_KEYS = {
  USER_TOKEN: 'user_token',
  USER_INFO: 'user_info',
  LANGUAGE: 'language',
  THEME: 'theme',
  CART: 'cart',
  FAVORITES: 'favorites',
  RECENT_SEARCHES: 'recent_searches',
  SETTINGS: 'settings'
} as const

// API 配置
export const API_CONFIG = {
  TIMEOUT: 30000, // 30秒
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000, // 1秒
  RATE_LIMIT: 100 // 每分钟请求数
} as const

// 验证配置
export const VALIDATION_CONFIG = {
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,
  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 50,
  DESCRIPTION_MAX_LENGTH: 1000,
  PHONE_LENGTH: 11,
  ID_CARD_LENGTH: 18
} as const

// 通知配置
export const NOTIFICATION_CONFIG = {
  AUTO_CLOSE_DELAY: 5000, // 5秒
  MAX_NOTIFICATIONS: 5,
  POSITION: 'topRight'
} as const

// 动画配置
export const ANIMATION_CONFIG = {
  FAST: 200,
  NORMAL: 300,
  SLOW: 500,
  VERY_SLOW: 1000
} as const

// 颜色配置
export const COLORS = {
  PRIMARY: '#ffd700',
  SECONDARY: '#ffed4e',
  SUCCESS: '#52c41a',
  WARNING: '#faad14',
  ERROR: '#ff4d4f',
  INFO: '#1890ff',
  TEXT_PRIMARY: '#f8f8f8',
  TEXT_SECONDARY: '#c0c0c0',
  TEXT_TERTIARY: '#999999',
  BACKGROUND_PRIMARY: '#0a0a0a',
  BACKGROUND_SECONDARY: '#1a1a1a',
  BACKGROUND_TERTIARY: '#2d2d2d',
  BORDER_PRIMARY: '#333333',
  BORDER_SECONDARY: '#444444'
} as const

// 状态颜色映射
export const STATUS_COLORS = {
  // 订单状态
  'order:pending': 'orange',
  'order:confirmed': 'blue',
  'order:shipped': 'cyan',
  'order:delivered': 'green',
  'order:cancelled': 'red',
  // 活动状态
  'event:draft': 'default',
  'event:published': 'green',
  'event:cancelled': 'red',
  'event:completed': 'blue',
  // 品牌状态
  'brand:active': 'green',
  'brand:inactive': 'red',
  // 雪茄强度
  'cigar:mild': 'green',
  'cigar:medium': 'orange',
  'cigar:full': 'red',
  // 库存操作
  'inventory:in': 'green',
  'inventory:out': 'red',
  'inventory:adjustment': 'blue'
} as const

// 图标映射
export const STATUS_ICONS = {
  // 订单状态
  'order:pending': 'clock-circle',
  'order:confirmed': 'check-circle',
  'order:shipped': 'car',
  'order:delivered': 'check',
  'order:cancelled': 'close-circle',
  // 活动状态
  'event:draft': 'edit',
  'event:published': 'eye',
  'event:cancelled': 'close',
  'event:completed': 'check',
  // 品牌状态
  'brand:active': 'check-circle',
  'brand:inactive': 'close-circle'
} as const

// 权限配置
export const PERMISSIONS = {
  // 用户管理
  USER_VIEW: 'user:view',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  
  // 品牌管理
  BRAND_VIEW: 'brand:view',
  BRAND_CREATE: 'brand:create',
  BRAND_UPDATE: 'brand:update',
  BRAND_DELETE: 'brand:delete',
  
  // 产品管理
  PRODUCT_VIEW: 'product:view',
  PRODUCT_CREATE: 'product:create',
  PRODUCT_UPDATE: 'product:update',
  PRODUCT_DELETE: 'product:delete',
  
  // 库存管理
  INVENTORY_VIEW: 'inventory:view',
  INVENTORY_UPDATE: 'inventory:update',
  
  // 订单管理
  ORDER_VIEW: 'order:view',
  ORDER_CREATE: 'order:create',
  ORDER_UPDATE: 'order:update',
  ORDER_DELETE: 'order:delete',
  
  // 活动管理
  EVENT_VIEW: 'event:view',
  EVENT_CREATE: 'event:create',
  EVENT_UPDATE: 'event:update',
  EVENT_DELETE: 'event:delete',
  
  // 财务管理
  FINANCE_VIEW: 'finance:view',
  FINANCE_UPDATE: 'finance:update',
  
  // 系统管理
  SYSTEM_VIEW: 'system:view',
  SYSTEM_UPDATE: 'system:update'
} as const

// 路由配置
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  PROFILE: '/profile',
  ADMIN: '/admin',
  ADMIN_USERS: '/admin/users',
  ADMIN_PRODUCTS: '/admin/products',
  ADMIN_INVENTORY: '/admin/inventory',
  ADMIN_ORDERS: '/admin/orders',
  ADMIN_EVENTS: '/admin/events',
  ADMIN_FINANCE: '/admin/finance',
  ADMIN_SETTINGS: '/admin/settings',
  EVENTS: '/events',
  SHOP: '/shop',
  CART: '/cart',
  CHECKOUT: '/checkout',
  ORDERS: '/orders'
} as const

// 导出所有常量
export const CONSTANTS = {
  APP_INFO,
  USER_ROLES,
  MEMBERSHIP_LEVELS,
  ORDER_STATUS,
  EVENT_STATUS,
  BRAND_STATUS,
  CIGAR_STRENGTH,
  INVENTORY_OPERATIONS,
  PAYMENT_METHODS,
  LANGUAGES,
  THEMES,
  FILE_TYPES,
  IMAGE_FORMATS,
  BREAKPOINTS,
  PAGINATION,
  FILE_SIZE_LIMITS,
  CACHE_CONFIG,
  STORAGE_KEYS,
  API_CONFIG,
  VALIDATION_CONFIG,
  NOTIFICATION_CONFIG,
  ANIMATION_CONFIG,
  COLORS,
  STATUS_COLORS,
  STATUS_ICONS,
  PERMISSIONS,
  ROUTES
} as const

export default CONSTANTS
