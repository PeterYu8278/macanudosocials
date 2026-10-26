import type { LoungeDebtDetails } from '../types/loungeReport';

/** Correct a known legacy false positive using saved evidence only, never today's wallet. */
export function correctLegacyLoungeDebtDetails(details: LoungeDebtDetails): LoungeDebtDetails {
  if (details.schemaVersion != null && details.schemaVersion !== 1) return details;
  let changed = false;
  const customers = details.customers.map(row => {
    if (!row.reasons.includes('missing-checkpoint') || !row.reasons.includes('wallet-mismatch')
      || row.expectedBalance != null) return row;
    changed = true;
    return { ...row, reliable: false, expectedBalance: null, difference: null,
      opening: null, added: null, repaid: null, outstanding: null,
      reasons: row.reasons.filter(reason => reason !== 'wallet-mismatch') };
  });
  return changed ? { ...details, customers, legacyCorrection: 'saved-evidence-only' } : details;
}
