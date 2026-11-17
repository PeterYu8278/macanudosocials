import { createHmac } from 'node:crypto';

export async function dispatchLoungeClosing(storeId: string, businessDate: string, manual = false) {
  const secret = process.env.LOUNGE_JOB_SECRET || '', origin = process.env.URL;
  if (secret.length < 32 || !origin || !origin.startsWith('https://')) throw new Error('not-ready');
  const body = JSON.stringify({ storeId, businessDate, manual, issuedAt: Date.now() });
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  const response = await fetch(new URL('/.netlify/functions/lounge-closing-background', origin), {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-lounge-signature': signature },
    body, signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 202) throw new Error('dispatch-failed');
  return { queued: true };
}
