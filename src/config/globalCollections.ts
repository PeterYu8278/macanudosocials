/**
 * 全局 Firebase Collection IDs
 * 集中管理所有 Firestore 集合名称
 */

export const GLOBAL_COLLECTIONS = {
  MIGRATION_BATCHES: 'migrationBatches',
  MEMBERSHIP_PAYMENTS: '_membershipPayments',
  MEMBERSHIP_PAYMENT_STATUSES: '_membershipPaymentStatuses',
  MEMBERSHIP_PAYMENT_LOCKS: '_membershipPaymentLocks',
  FIRESTORE_METRICS: '_firestoreMetrics',
  FIRESTORE_HOURLY_METRICS: '_firestoreMetricsHourly',
  FIRESTORE_METRIC_INGRESS: '_firestoreMetricIngress',
  /** 用户集合 */
  USERS: 'users',
  STORES: 'stores',
  LOUNGE_BATCHES: '_loungeClosingBatches',
  LOUNGE_REPORTS: '_loungeDailyReports',
  LOUNGE_TEST_REPORTS: '_loungeTestReports',
  MEMBER_IDENTITY_LOCKS: '_memberIdentityLocks',
  REGISTRATION_ATTEMPTS: '_registrationAttempts',
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
  CONFIG: 'config',
  /** 积分记录集合 */
  POINTS_RECORDS: 'pointsRecords',
  /** 驻店记录集合 */
  VISIT_SESSIONS: 'visitSessions',
  DASHBOARD_VISIT_STATS: '_dashboardVisitStats',
  DASHBOARD_VISIT_STATS_META: '_dashboardVisitStatsMeta',
  DASHBOARD_REDEMPTION_STATS: '_dashboardRedemptionStats',
  DASHBOARD_REDEMPTION_STATS_META: '_dashboardRedemptionStatsMeta',
  VISIT_MEMBER_STATS: '_visitMemberStats',
  VISIT_MEMBER_STATS_META: '_visitMemberStatsMeta',
  ADMIN_VISIT_PAGINATION_META: '_adminVisitPaginationMeta',
  /** 会员年费记录集合 */
  MEMBERSHIP_FEE_RECORDS: 'membershipFeeRecords',
  /** 充值记录集合 */
  RELOAD_RECORDS: 'reloadRecords',
  /** 兑换配置集合 */
  REDEMPTION_CONFIG: 'redemptionConfig',
  /** 兑换记录集合 */
  REDEMPTION_RECORDS: 'redemptionRecords',
  REDEMPTION_STATS: '_redemptionStats',
  REDEMPTION_STATS_META: '_redemptionStatsMeta',
  /** 功能可见性配置集合 */
  FEATURE_VISIBILITY: 'feature_visibility',
  /** 应用配置集合 */
  APP_CONFIG: 'app_config',
  /** Whapi 消息记录集合 */
  WHAPI_MESSAGES: 'whapi_messages',
  WHATSAPP_CONFIG: '_whatsappConfig',
  WHATSAPP_TASKS: '_whatsappTasks',
  WHATSAPP_ATTEMPTS: '_whatsappAttempts',
  WHATSAPP_RECEIPTS: '_whatsappReceipts',
  WHATSAPP_REGISTRATION_SESSIONS: '_whatsappRegistrationSessions',
  WHATSAPP_INBOX: '_whatsappInbox',
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
