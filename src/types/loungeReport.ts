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
  entries: Array<{ id: string; at: string | null; amount: number | null; before: number | null;
    after: number | null; source: string; relatedId: string; description: string; local: boolean }>;
}
export interface LoungeDebtDetails {
  businessDate: string;
  from: string;
  to: string;
  historical: boolean;
  customers: LoungeDebtCustomer[];
  otherReviewCount: number;
  truncated: boolean;
}
