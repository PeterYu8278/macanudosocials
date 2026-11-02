export function managedLoungeIds(user: { storeId?: unknown; storeIds?: unknown } | null | undefined): string[] {
  return [...new Set([user?.storeId, ...(Array.isArray(user?.storeIds) ? user.storeIds : [])]
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0))].sort();
}
export function canManageLounge(user: { role?: string; storeId?: unknown; storeIds?: unknown } | null | undefined, storeId: string) {
  return ['developer', 'superAdmin'].includes(user?.role || '')
    || ['admin', 'storeAdmin'].includes(user?.role || '') && managedLoungeIds(user).includes(storeId);
}
