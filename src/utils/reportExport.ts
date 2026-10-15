const hiddenColumns = new Set(['User ID', 'Points Record ID', 'Membership Order ID']);

export function visibleReportRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(row => Object.fromEntries(Object.entries(row).filter(([column]) => !hiddenColumns.has(column))));
}
