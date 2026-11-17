export function inventoryOperatorName(
  operatorId: string | undefined,
  names: Record<string, string>,
  labels: { system: string; historical: string; unknown: string },
): string {
  if (!operatorId) return '-';
  if (operatorId === 'system') return labels.system;
  if (operatorId === 'legacy_migration') return labels.historical;
  const name = Object.prototype.hasOwnProperty.call(names, operatorId) ? names[operatorId] : undefined;
  return name?.trim() || labels.unknown;
}
