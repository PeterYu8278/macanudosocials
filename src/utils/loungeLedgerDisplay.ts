import type { LoungeDebtCustomer } from '../types/loungeReport';

type Entry = LoungeDebtCustomer['entries'][number];
export type LoungeLedgerDisplayEntry = Entry & { ledgerIds: string[]; visitGroup: boolean; interleaved: boolean };

/** Group saved evidence for display only; never feed these rows into reconciliation. */
export function groupLoungeLedgerEntries(entries: Entry[]): LoungeLedgerDisplayEntry[] {
  const groups = new Map<string, Entry[]>();
  const keyOf = (entry: Entry) => entry.source === 'visit' && entry.relatedId
    && ['included', 'historical-included'].includes(entry.participation || '')
    && entry.amount != null && Number.isFinite(entry.amount) && entry.at && Number.isFinite(Date.parse(entry.at))
    && ['Visit first-hour charge', 'Visit interval charge', 'Visit final settlement', 'Visit rebate'].includes(entry.description)
    ? JSON.stringify([entry.relatedId, entry.participation, entry.local]) : undefined;
  for (const entry of entries) {
    const key = keyOf(entry);
    if (key) groups.set(key, [...(groups.get(key) || []), entry]);
  }
  const emitted = new Set<string>();
  const result: LoungeLedgerDisplayEntry[] = [];
  for (const entry of entries) {
    const key = keyOf(entry);
    if (!key) { result.push({ ...entry, ledgerIds: [entry.id], visitGroup: false, interleaved: false }); continue; }
    if (emitted.has(key)) continue;
    emitted.add(key);
    const group = groups.get(key)!.slice().sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
    const first = group[0], last = group[group.length - 1], ids = new Set(group.map(e => e.id));
    // Recharges or another visit in this interval prevent a truthful single before/after pair.
    const interleaved = entries.some(e => !ids.has(e.id) && e.at && Date.parse(e.at) >= Date.parse(first.at!)
      && Date.parse(e.at) <= Date.parse(last.at!) && ['included', 'historical-included'].includes(e.participation || ''))
      || new Set(group.map(e => e.at)).size !== group.length;
    result.push({ ...last, id: `visit:${key}`, amount: group.reduce((sum, e) => sum + Math.round(e.amount! * 100), 0) / 100,
      before: interleaved ? null : first.before, after: interleaved ? null : last.after,
      calculatedBefore: interleaved ? undefined : first.calculatedBefore,
      calculatedAfter: interleaved ? undefined : last.calculatedAfter,
      ledgerIds: [...ids], visitGroup: true, interleaved });
  }
  return result.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}
