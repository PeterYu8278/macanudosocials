import type { DebtBaseline } from '../utils/loungeDebt';
export interface LoungeDebtCustomer {
  userId: string;
  name: string;
  memberId: string;
  reliable: boolean;
  reasons: string[];
  walletBalance: number | null;
  opening: number | null;
  added: number | null;
  repaid: number | null;
  outstanding: number | null;
  entryCount: number;
  expectedBalance?: number | null;
  difference?: number | null;
  baseline?: DebtBaseline | null;
  entryCounts?: { historical: number; summary: number; included: number; beforeBaseline: number; invalid: number };
  entries: Array<{ id: string; at: string | null; amount: number | null; before: number | null;
    after: number | null; source: string; relatedId: string; description: string; local: boolean;
    participation?: 'historical' | 'summary' | 'before-baseline' | 'included' | 'invalid' }>;
}
export interface LoungeDebtDetails {
  businessDate: string;
  from: string;
  to: string;
  historical: boolean;
  customers: LoungeDebtCustomer[];
  otherReviewCount: number;
  truncated: boolean;
  schemaVersion?: number;
  consistency?: 'transaction';
  legacyCorrection?: 'saved-evidence-only';
}
