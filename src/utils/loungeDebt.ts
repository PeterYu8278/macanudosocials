export interface DebtLot { storeId: string | null; amount: number; openedAt: number }
export interface DebtEntry { id: string; at: number; amount: number; before?: number; after?: number; storeId?: string }
const round = (n: number) => Math.round(n * 100) / 100;

// Missing checkpoints are not evidence of a zero opening balance.
export function reconcileLoungeDebt(entries: DebtEntry[], opening: number, closing: number, currentBalance?: number) {
  const lots: DebtLot[] = [];
  const openingByStore: Record<string, number> = {}, added: Record<string, number> = {}, repaid: Record<string, number> = {};
  let balance: number | undefined, reliable = true, anchored = false;
  const key = (storeId: string | null) => storeId || 'unallocated';
  const totals = () => lots.reduce((out, lot) => { out[key(lot.storeId)] = round((out[key(lot.storeId)] || 0) + lot.amount); return out; }, {} as Record<string, number>);
  const rows = entries.filter(e => e.at <= closing).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  let opened = false;
  for (const entry of rows) {
    if (!Number.isFinite(entry.at) || !Number.isFinite(entry.amount)) { reliable = false; continue; }
    const before = Number.isFinite(entry.before) ? entry.before! : Number.isFinite(entry.after) ? round(entry.after! - entry.amount) : undefined;
    if (balance === undefined) {
      if (before === undefined) { reliable = false; continue; }
      balance = before; anchored = true;
      if (before < 0) lots.push({ storeId: null, amount: -before, openedAt: 0 });
    }
    if (before !== undefined && Math.abs(before - balance) > 0.01) {
      // An unrecorded adjustment cannot be assigned to a particular lounge.
      reliable = false; lots.length = 0; balance = before;
      if (before < 0) lots.push({ storeId: null, amount: -before, openedAt: entry.at });
    }
    if (!opened && entry.at >= opening) { Object.assign(openingByStore, totals()); opened = true; }
    const after = round(balance + entry.amount), change = round(Math.max(0, -after) - Math.max(0, -balance));
    if (change > 0) {
      const storeId = entry.storeId || null;
      lots.push({ storeId, amount: change, openedAt: entry.at });
      if (entry.at >= opening) added[key(storeId)] = round((added[key(storeId)] || 0) + change);
    } else if (change < 0) {
      let remaining = -change;
      while (remaining > 0.001 && lots.length) {
        const lot = lots[0], paid = Math.min(remaining, lot.amount);
        if (entry.at >= opening) repaid[key(lot.storeId)] = round((repaid[key(lot.storeId)] || 0) + paid);
        lot.amount = round(lot.amount - paid); remaining = round(remaining - paid);
        if (lot.amount <= 0) lots.shift();
      }
    }
    balance = after;
    if (entry.after !== undefined && Math.abs(after - entry.after) > 0.01) reliable = false;
  }
  if (!opened) Object.assign(openingByStore, totals());
  if (currentBalance !== undefined && (balance === undefined || Math.abs(balance - currentBalance) > 0.01)) reliable = false;
  return { reliable: reliable && anchored, opening: openingByStore, added, repaid, closing: totals(), lots };
}
