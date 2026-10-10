import { auth } from '../config/firebase';

export interface MembershipPaymentQuote {
  annualFee: number;
  renewal: boolean;
  pending?: boolean;
  reloadAmount?: number;
  storeId?: string;
}

async function membershipPaymentRequest(query: string, body?: { reloadAmount: number; storeId: string }) {
  if (!auth.currentUser) throw new Error('UNAUTHENTICATED');
  const response = await fetch(`/.netlify/functions/membership-payment${query}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${await auth.currentUser.getIdToken()}`, 'Content-Type': 'application/json' },
    ...(body && { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.code || 'PAYMENT_UNAVAILABLE');
  return result;
}

export const getMembershipPaymentQuote = async (): Promise<MembershipPaymentQuote> => membershipPaymentRequest('');
export const createMembershipPayment = async (reloadAmount: number, storeId: string): Promise<{ paymentUrl: string; resumed?: boolean }> =>
  membershipPaymentRequest('', { reloadAmount, storeId });
export const getMembershipPaymentStatus = async (orderId: string): Promise<{ status: string }> =>
  membershipPaymentRequest(`?order=${encodeURIComponent(orderId)}`);

interface ActivationResponse {
  success: boolean;
  code?: string;
  error?: string;
  required?: number;
  current?: number;
  amount?: number;
  balance?: number;
  activeUntil?: string;
}

const getActivationError = (result: ActivationResponse) => {
  switch (result.code) {
    case 'ALREADY_ACTIVE':
      return 'Annual Pass is already active';
    case 'ACCOUNT_SUSPENDED':
      return 'This account is suspended';
    case 'INSUFFICIENT_POINTS':
      return `Insufficient points. Required ${result.required || 0}, current ${result.current || 0}`;
    case 'UNAUTHENTICATED':
      return 'Please sign in again';
    case 'USER_NOT_FOUND':
      return 'User account was not found';
    default:
      return result.error || 'Unable to activate Annual Pass';
  }
};

export const activateMembership = async (storeId?: string): Promise<ActivationResponse> => {
  const currentUser = auth.currentUser;
  if (!currentUser) return { success: false, code: 'UNAUTHENTICATED', error: 'Please sign in again' };

  try {
    const token = await currentUser.getIdToken();
    const response = await fetch('/.netlify/functions/activate-membership', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ storeId }),
    });
    const text = await response.text();
    const result = text ? JSON.parse(text) as ActivationResponse : { success: false };

    if (!response.ok || !result.success) {
      return { ...result, success: false, error: getActivationError(result) };
    }
    return result;
  } catch (error: any) {
    return { success: false, error: error?.message || 'Unable to activate Annual Pass' };
  }
};
