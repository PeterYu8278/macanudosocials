import { auth } from '../config/firebase';
import i18n from '../i18n';

const pendingRequests = new Map<string, string>();
export async function requestDayPass(input: Record<string, unknown>): Promise<{
  success: boolean; error?: string; enabled?: boolean; sessionId?: string;
}> {
  try {
    if (!auth.currentUser) throw new Error('auth-required');
    const token = await auth.currentUser.getIdToken();
    const response = await fetch('/.netlify/functions/day-pass', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(input), signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.code || 'service-unavailable');
    return result as { success: boolean; enabled?: boolean; sessionId?: string };
  } catch (error: any) {
    const key = `dayPassControl.errors.${error.message}`;
    return { success: false, error: i18n.t(i18n.exists(key) ? key : 'dayPassControl.errors.service-unavailable') };
  }
}

export async function buyDayPass(userId: string, storeId: string, sessionId?: string) {
  const key = `${userId}:${storeId}:${sessionId || ''}`;
  const requestId = pendingRequests.get(key) || crypto.randomUUID();
  pendingRequests.set(key, requestId);
  const result = await requestDayPass({ action: 'purchase', userId, storeId, sessionId, requestId });
  if (result.success) pendingRequests.delete(key);
  return result;
}
