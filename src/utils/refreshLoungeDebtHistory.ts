import type { LoungeDebtDetails, LoungeDebtCustomer } from '../types/loungeReport';
import { reconcileLoungeDebt, validDebtBaseline } from './loungeDebt.ts';
import { walletLedgerTreatments, type WalletLedgerEvidence } from './walletLedgerEvidence.ts';
import { classifyPointsRecord } from './pointsRecordClassification.ts';

export interface ArchivedLedgerSource {
  id: string; createdAt: number; updatedAt: number;
  record: WalletLedgerEvidence & { at: number; amount: number; before?: number; after?: number; storeId?: string };
}
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

/** Rebuild only the saved customer scope, comparing against saved wallets, never current wallets. */
export function refreshLoungeDebtHistory(details: LoungeDebtDetails, storeId: string, sources: ArchivedLedgerSource[], refreshedAt: string) {
  if (!Number.isFinite(Date.parse(details.from)) || !Number.isFinite(Date.parse(details.to)) || !details.customers.length)
    return null;
  const cutoff = Date.parse(details.to), opening = Date.parse(details.from);
  const eligible = sources.filter(source => source.createdAt <= cutoff);
  let budget = 1000, truncated = false, skipped = 0;
  const customers = details.customers.map(saved => {
    const available = eligible.filter(source => source.record.userId === saved.userId);
    if (available.some(source => source.updatedAt > cutoff)
      || saved.entries.some(entry => !available.some(source => source.id === entry.id))) {
      skipped++; truncated ||= saved.entries.length < saved.entryCount;
      return saved;
    }
    const rows = available.filter(source => !Number.isFinite(source.record.at) || source.record.at <= cutoff);
    const treatments = walletLedgerTreatments(rows.map(source => ({ ...source.record, id: source.id })));
    const baseline = saved.baseline || undefined;
    const covered = (source: ArchivedLedgerSource) => baseline && validDebtBaseline(baseline)
      && baseline.approvedAt <= cutoff && source.record.at <= baseline.at;
    const included = rows.filter(source => ['included', 'historical-included'].includes(treatments.get(source.id)!) && !covered(source));
    const result = reconcileLoungeDebt(included.map(source => ({ ...source.record, id: source.id })), opening, cutoff,
      saved.walletBalance ?? undefined, baseline, 'zero');
    const reliable = result.reliable && finite(saved.walletBalance) !== null;
    const evidence: LoungeDebtCustomer['entries'] = rows.map((source): LoungeDebtCustomer['entries'][number] => {
      const record = source.record, treatment = treatments.get(source.id)!, calculated = result.calculatedBalances[source.id];
      const active = treatment === 'included' || treatment === 'historical-included';
      const valid = Number.isFinite(record.at) && Number.isFinite(record.amount);
      return { id: source.id, at: Number.isFinite(record.at) ? new Date(record.at).toISOString() : null,
        amount: finite(record.amount), before: finite(record.before), after: finite(record.after), source: record.source || '',
        local: record.storeId === storeId, historical: classifyPointsRecord(record) === 'historical',
        description: !record.storeId || record.storeId === storeId ? (record.description || '').slice(0, 160) : '',
        relatedId: record.storeId === storeId ? (record.relatedId || '').slice(0, 160) : '',
        participation: !active ? treatment : covered(source) ? 'before-baseline' : valid ? treatment : 'invalid',
        ...(calculated ? { calculatedBefore: calculated.before, calculatedAfter: calculated.after } : {}) };
    }).sort((a, b) => (b.at || '').localeCompare(a.at || '') || a.id.localeCompare(b.id));
    const entries = evidence.slice(0, Math.min(500, budget)); budget -= entries.length;
    truncated ||= entries.length < evidence.length;
    return { ...saved, reliable, expectedBalance: result.expectedBalance, difference: result.difference,
      reasons: [...new Set([...result.reasons, ...(finite(saved.walletBalance) === null ? ['wallet-missing'] : [])])],
      opening: reliable ? result.opening[storeId] || 0 : null, added: reliable ? result.added[storeId] || 0 : null,
      repaid: reliable ? result.repaid[storeId] || 0 : null, outstanding: reliable ? result.closing[storeId] || 0 : null,
      entries, entryCount: evidence.length, entryCounts: { historical: evidence.filter(entry => entry.historical).length,
        included: evidence.filter(entry => ['included', 'historical-included'].includes(entry.participation || '')).length,
        summary: evidence.filter(entry => entry.participation === 'summary').length,
        beforeBaseline: evidence.filter(entry => entry.participation === 'before-baseline').length,
        invalid: evidence.filter(entry => entry.participation === 'invalid').length } };
  });
  const { legacyCorrection: _oldNotice, ...original } = details;
  return { ...original, customers, truncated, schemaVersion: 2,
    ...(skipped === 0 ? { balanceOrigin: 'zero' as const } : {}),
    historyRefresh: { version: 1, mode: 'original-cutoff' as const, refreshedAt, skippedCustomers: skipped } };
}
