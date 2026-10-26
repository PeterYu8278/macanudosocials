import { classifyPointsRecord } from './pointsRecordClassification.ts';

export interface WalletLedgerEvidence {
  id: string; userId?: string; source?: string; relatedId?: string; type?: string;
  createdBy?: string; description?: string; isVisitSessionSummary?: boolean;
  migration?: { source?: string; balanceNotApplied?: boolean };
}
export type WalletLedgerTreatment = 'included' | 'historical-included' | 'summary' | 'duplicate';

/** A history import is evidence of a past transaction, not a request to apply a wallet write. */
export function walletLedgerTreatments(records: WalletLedgerEvidence[]): Map<string, WalletLedgerTreatment> {
  const key = (record: WalletLedgerEvidence) => record.userId && record.source && record.relatedId && record.type
    ? JSON.stringify([record.userId, record.source, record.relatedId, record.type]) : null;
  const actualLinks = new Set(records.filter(row => !row.isVisitSessionSummary && classifyPointsRecord(row) === 'transaction')
    .map(key).filter((value): value is string => value !== null));
  return new Map(records.map(row => {
    const historical = classifyPointsRecord(row) === 'historical', link = key(row);
    return [row.id, row.isVisitSessionSummary ? 'summary' : historical && link && actualLinks.has(link) ? 'duplicate'
      : historical ? 'historical-included' : 'included'];
  }));
}
