import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { reconcileWebsiteConversions } from './_shared/websiteTraffic';
import type { Config } from '@netlify/functions';

export default async function handler() {
  if (process.env.WEBSITE_TRAFFIC_ENABLED === 'false') return;
  if (!getApps().length) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('TRAFFIC_CREDENTIALS_MISSING');
    initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  }
  await reconcileWebsiteConversions(getFirestore());
}
export const config: Config = { schedule: '*/5 * * * *' };
