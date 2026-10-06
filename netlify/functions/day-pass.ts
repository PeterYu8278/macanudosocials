import type { Handler } from '@netlify/functions';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { executeDayPass } from './_shared/dayPass';

const reply = (statusCode: number, code: string, extra = {}) => ({
  statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify({ success: statusCode === 200, code, ...extra }),
});

export const handler: Handler = async event => {
  if (event.httpMethod !== 'POST') return reply(405, 'method-not-allowed');
  let input;
  try {
    if (!event.body || event.body.length > 4096) return reply(400, 'invalid-request');
    input = JSON.parse(event.body);
    if (!input || !['purchase', 'set-enabled'].includes(input.action)) return reply(400, 'invalid-request');
  } catch { return reply(400, 'invalid-request'); }
  const token = (event.headers.authorization || event.headers.Authorization || '').match(/^Bearer (.+)$/)?.[1];
  if (!token) return reply(401, 'auth-required');
  try {
    if (!getApps().length) {
      const credentials = process.env.FIREBASE_SERVICE_ACCOUNT;
      if (!credentials) throw new Error('service-unavailable');
      initializeApp({ credential: cert(JSON.parse(credentials)) });
    }
    const identity = await getAuth().verifyIdToken(token, true);
    const db = getFirestore();
    return reply(200, 'saved', await executeDayPass(db, identity.uid, input, Timestamp.now()));
  } catch (error: any) {
    const code = error?.message || 'service-unavailable';
    if (String(error?.code).startsWith('auth/')) return reply(401, 'auth-required');
    const statuses: Record<string, number> = {
      'invalid-request': 400, forbidden: 403, 'member-not-found': 404, 'lounge-not-found': 404,
      disabled: 409, 'invalid-config': 409, 'insufficient-points': 409, 'invalid-session': 409,
      'account-suspended': 403,
    };
    return reply(statuses[code] || 503, statuses[code] ? code : 'service-unavailable');
  }
};
