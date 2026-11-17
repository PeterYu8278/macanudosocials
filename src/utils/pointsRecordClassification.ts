export type PointsRecordKind = 'historical' | 'summary' | 'transaction';

/** Display-only history and cumulative summaries must never be applied to a wallet twice. */
export function classifyPointsRecord(record: {
  createdBy?: string; description?: string; isVisitSessionSummary?: boolean;
  migration?: { source?: string; balanceNotApplied?: boolean };
}): PointsRecordKind {
  if (record.migration?.source === 'legacy_workbook' || record.migration?.balanceNotApplied === true
    || record.createdBy === 'legacy_migration' || record.description === 'Historical reload import'
    || record.description === 'Historical visit fee import') return 'historical';
  return record.isVisitSessionSummary ? 'summary' : 'transaction';
}
