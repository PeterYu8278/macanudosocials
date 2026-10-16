import { createHmac, timingSafeEqual } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from './_shared/firestoreMonitoring';
import { runLoungeClosing } from './_shared/loungeClosing';
import { toWebFunction } from './_shared/webFunction';

export default toWebFunction(async event => {
  const secret = process.env.LOUNGE_JOB_SECRET || '', signature = event.headers['x-lounge-signature'] || '';
  if (process.env.LOUNGE_OPERATIONS_ENABLED !== 'true' || secret.length < 32 || event.httpMethod !== 'POST'
    || !event.body || event.body.length > 2048 || !/^[a-f0-9]{64}$/.test(signature)) return { statusCode: 403 };
  const expected = createHmac('sha256', secret).update(event.body).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return { statusCode: 403 };
  const input = JSON.parse(event.body);
  if (!/^[\w-]{1,160}$/.test(input.storeId) || !/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)
    || typeof input.issuedAt !== 'number' || Math.abs(Date.now() - input.issuedAt) > 300000) return { statusCode: 403 };
  if (!getApps().length) {
    const credentials = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!credentials) throw new Error('not-ready');
    initializeApp({ credential: cert(JSON.parse(credentials)) });
  }
  await runLoungeClosing(getFirestore(), input.storeId, new Date(), { manual: input.manual === true, businessDate: input.businessDate });
  return { statusCode: 200 };
});
