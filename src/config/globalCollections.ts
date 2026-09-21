/**
 * 全局 Firebase Collection IDs
 * 集中管理所有 Firestore 集合名称
 */

export const GLOBAL_COLLECTIONS = {
  /** 用户集合 */
  USERS: 'users',
  /** 品牌集合 */
  BRANDS: 'brands',
  /** 雪茄产品集合（库存管理） */
  CIGARS: 'cigars',
  /** 雪茄数据库集合（详细信息库） */
  CIGAR_DATABASE: 'cigar_database',
  /** 订单集合 */
  ORDERS: 'orders',
  /** 活动集合 */
  EVENTS: 'events',
  /** 会员集合 */
  MEMBERS: 'members',
  /** 入库订单集合 */
  INBOUND_ORDERS: 'inbound_orders',
  /** 出库订单集合 */
  OUTBOUND_ORDERS: 'outbound_orders',
  /** 库存变动索引集合 */
  INVENTORY_MOVEMENTS: 'inventory_movements',
  /** 通知集合 */
  NOTIFICATIONS: 'notifications',
  /** 系统配置集合 */
  SYSTEM_CONFIG: 'system_config',
  /** 积分记录集合 */
  POINTS_RECORDS: 'pointsRecords',
  /** 驻店记录集合 */
  VISIT_SESSIONS: 'visitSessions',
  /** 会员年费记录集合 */
  MEMBERSHIP_FEE_RECORDS: 'membershipFeeRecords',
  /** 充值记录集合 */
  RELOAD_RECORDS: 'reloadRecords',
  /** 兑换配置集合 */
  REDEMPTION_CONFIG: 'redemptionConfig',
  /** 兑换记录集合 */
  REDEMPTION_RECORDS: 'redemptionRecords',
  /** 功能可见性配置集合 */
  FEATURE_VISIBILITY: 'feature_visibility',
  /** 应用配置集合 */
  APP_CONFIG: 'app_config',
  /** Whapi 消息记录集合 */
  WHAPI_MESSAGES: 'whapi_messages',
  /** 订阅激活请求 */
  SUBSCRIPTION_REQUESTS: 'subscription_requests',
  /** 交易记录（财务） */
  TRANSACTIONS: 'transactions',
  /** 操作审计日志 */
  AUDIT_LOGS: 'audit_logs',
  /** 公告集合 */
  ANNOUNCEMENTS: 'announcements'
} as const

export type CollectionName = typeof GLOBAL_COLLECTIONS[keyof typeof GLOBAL_COLLECTIONS]
