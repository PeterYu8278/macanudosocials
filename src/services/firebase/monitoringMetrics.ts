// Only fixed labels belong here: never include IDs, filter values, or URLs.
export const MONITORING_OPERATIONS = [
  'dashboard.summary', 'dashboard.users', 'dashboard.orders', 'dashboard.transactions',
  'dashboard.visits', 'dashboard.reloads', 'dashboard.memberships',
  'pagination.users', 'pagination.orders', 'pagination.transactions', 'pagination.visits',
  'pagination.inboundOrders', 'pagination.outboundOrders',
  'home.summary', 'home.events', 'home.announcements', 'home.membership', 'home.visits',
  'dashboard.pendingVisits', 'visitSessions.historyPage', 'redemptions.byStore',
  'home.activeVisit', 'home.memberStats',
] as const;
export type MonitoringOperation = typeof MONITORING_OPERATIONS[number];
export const isMonitoringOperation = (value: unknown): value is MonitoringOperation =>
  typeof value === 'string' && (MONITORING_OPERATIONS as readonly string[]).includes(value);

export const OPTIONAL_METRIC_COUNTERS = [
  'requests', 'readRequests', 'latencyMs', 'latencySamples',
  'listenerInitialSnapshots', 'listenerChangeSnapshots', 'listenerInitialReads', 'listenerChangeReads',
] as const;
export type OptionalMetricCounter = typeof OPTIONAL_METRIC_COUNTERS[number];
export type ExtendedMetrics = Partial<Record<OptionalMetricCounter, number>> & { operation?: MonitoringOperation };
export const metricCounterLimit = (key: string) => key === 'latencyMs' ? 100_000_000 : 100_000;
