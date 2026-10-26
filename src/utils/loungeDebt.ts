export interface DebtLot { storeId: string | null; amount: number; openedAt: number }
export interface DebtEntry { id: string; at: number; amount: number; before?: number; after?: number; storeId?: string }
export interface DebtBaseline {
  version: number; at: number; balance: number; boundary: 'through_timestamp';
  evidenceReference: string; note: string; reviewedBy: string; approvedAt: number;
}
const round = (n: number) => Math.round(n * 100) / 100;
const numeric = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export const validDebtBaseline = (value: DebtBaseline): boolean => !!value && Number.isInteger(value.version) && value.version > 0
  && numeric(value.at) && numeric(value.balance) && round(value.balance) === value.balance
  && value.boundary === 'through_timestamp' && typeof value.evidenceReference === 'string' && !!value.evidenceReference.trim()
  && typeof value.note === 'string' && !!value.note.trim() && typeof value.reviewedBy === 'string' && !!value.reviewedBy
  && numeric(value.approvedAt) && value.approvedAt >= value.at;

// The current wallet is a comparison, never an opening-balance anchor.
export function reconcileLoungeDebt(entries: DebtEntry[], opening: number, closing: number, currentBalance?: number, baseline?: DebtBaseline) {
  const lots: DebtLot[] = [];
  const openingByStore: Record<string, number> = {}, added: Record<string, number> = {}, repaid: Record<string, number> = {};
  let balance: number | undefined, reliable = true, anchored = false, opened = false;
  const reasons = new Set<string>();
  const totals = () => lots.reduce((out, lot) => {
    const key = lot.storeId || 'unallocated'; out[key] = round((out[key] || 0) + lot.amount); return out;
  }, {} as Record<string, number>);
  const reset = (value: number, at: number) => {
    balance = value; lots.length = 0; anchored = true;
    if (value < 0) lots.push({ storeId: null, amount: -value, openedAt: at });
  };
  const baselineValid = baseline && validDebtBaseline(baseline) && baseline.at <= closing && baseline.approvedAt <= closing;
  if (baseline) {
    if (!baselineValid) { reasons.add('invalid-baseline'); reliable = false; }
    else {
      reset(baseline.balance, baseline.at);
      if (baseline.at > opening) { reasons.add('baseline-after-opening'); reliable = false; }
    }
  }
  const beforeOf = (entry: DebtEntry) => numeric(entry.before) ? entry.before
    : numeric(entry.after) && numeric(entry.amount) ? round(entry.after - entry.amount) : undefined;
  const rows = entries.filter(entry => !numeric(entry.at) || (entry.at <= closing && (!baselineValid || entry.at > baseline!.at)))
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  for (let index = 0; index < rows.length;) {
    const at = rows[index].at, group: DebtEntry[] = [rows[index++]];
    if (numeric(at)) while (index < rows.length && rows[index].at === at) group.push(rows[index++]);
    const pending = group.filter(entry => {
      if (!numeric(entry.at) || !numeric(entry.amount) || (entry.before !== undefined && !numeric(entry.before))
        || (entry.after !== undefined && !numeric(entry.after))) { reliable = false; reasons.add('invalid-entry'); return false; }
      return true;
    });
    while (pending.length) {
      const candidates = pending.filter(entry => {
        const before = beforeOf(entry);
        if (balance !== undefined) return before !== undefined && Math.abs(before - balance) < 0.005;
        return before !== undefined && !pending.some(other => other !== entry && numeric(other.after) && Math.abs(other.after - before) < 0.005);
      });
      // ID order does not establish financial order for equal timestamps.
      const entry = candidates.length === 1 ? candidates[0] : pending.length === 1 ? pending[0] : undefined;
      if (!entry) { reliable = false; reasons.add('ambiguous-order'); break; }
      pending.splice(pending.indexOf(entry), 1);
      const before = beforeOf(entry);
      if (balance === undefined) {
        if (before === undefined) { reliable = false; reasons.add('missing-checkpoint'); continue; }
        reset(before, entry.at);
      } else if (before !== undefined && Math.abs(before - balance) >= 0.005) {
        reliable = false; reasons.add('balance-gap'); reset(before, entry.at);
      }
      if (!opened && entry.at >= opening) { Object.assign(openingByStore, totals()); opened = true; }
      const after = round(balance! + entry.amount), change = round(Math.max(0, -after) - Math.max(0, -balance!));
      if (change > 0) {
        const key = entry.storeId || 'unallocated';
        lots.push({ storeId: entry.storeId || null, amount: change, openedAt: entry.at });
        if (entry.at >= opening) added[key] = round((added[key] || 0) + change);
      } else if (change < 0) {
        let remaining = -change;
        while (remaining > 0.001 && lots.length) {
          const lot = lots[0], paid = Math.min(remaining, lot.amount), key = lot.storeId || 'unallocated';
          if (entry.at >= opening) repaid[key] = round((repaid[key] || 0) + paid);
          lot.amount = round(lot.amount - paid); remaining = round(remaining - paid);
          if (lot.amount <= 0) lots.shift();
        }
      }
      balance = after;
      if (entry.after !== undefined && Math.abs(after - entry.after) >= 0.005) { reliable = false; reasons.add('entry-mismatch'); }
    }
  }
  if (!opened) Object.assign(openingByStore, totals());
  if (!anchored) reasons.add('missing-checkpoint');
  // No computed balance means no balance mismatch has been established.
  if (anchored && currentBalance !== undefined && (!numeric(currentBalance) || Math.abs(balance! - currentBalance) >= 0.005)) {
    reliable = false; reasons.add('wallet-mismatch');
  }
  return { reliable: reliable && anchored, reasons: [...reasons], expectedBalance: anchored ? balance! : null,
    difference: anchored && numeric(currentBalance) ? round(currentBalance - balance!) : null,
    opening: openingByStore, added, repaid, closing: totals(), lots };
}
