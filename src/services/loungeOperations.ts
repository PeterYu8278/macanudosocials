import { auth } from '../config/firebase';
import i18n from '../i18n';

export async function loungeRequest(action: string, data: Record<string, unknown> = {}): Promise<any> {
  if (!auth.currentUser) throw new Error(i18n.t('loungeOperations.error'));
  const token = await auth.currentUser.getIdToken();
  let response: Response;
  let result: any;
  try {
    response = await fetch('/.netlify/functions/lounge-operations', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data }), signal: AbortSignal.timeout(25000),
    });
    result = await response.json();
  } catch {
    throw new Error(i18n.t('loungeOperations.errors.backend-unavailable'));
  }
  if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.success !== 'boolean') {
    throw new Error(i18n.t('loungeOperations.errors.backend-unavailable'));
  }
  if (!response.ok || !result.success) {
    const key = `loungeOperations.errors.${typeof result.code === 'string' ? result.code : 'service-unavailable'}`;
    throw new Error(i18n.t(i18n.exists(key) ? key : 'loungeOperations.error'));
  }
  return result;
}

const requests = new Map<string, string>();
export async function managedCheckin(userId: string, storeId: string) {
  const key = `${userId}:${storeId}`;
  const requestId = requests.get(key) || crypto.randomUUID();
  requests.set(key, requestId);
  const result = await loungeRequest('checkin', { userId, storeId, requestId });
  requests.delete(key);
  return result;
}

export async function managedCheckout(sessionId: string, storeId: string, forceHours?: number) {
  const result = await loungeRequest('checkout', { sessionId, storeId, forceHours });
  if (result.status === 'insufficient') return { success: false, code: 'INSUFFICIENT_POINTS' as const,
    error: String(i18n.t('visitSessions.insufficientPointsCheckout', { ...result, minimumReload: 200 })) };
  return { success: true, pointsDeducted: result.pointsDeducted, rebatePoints: result.rebatePoints };
}
