import type { Handler } from '@netlify/functions';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const response = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

const getAdminDb = () => {
  if (!getApps().length) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawServiceAccount) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
    }

    initializeApp({
      credential: cert(JSON.parse(rawServiceAccount)),
    });
  }

  return getFirestore();
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return response(200, {});
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, error: 'Method not allowed' });
  }

  try {
    const { memberId } = JSON.parse(event.body || '{}') as { memberId?: string };
    const normalized = memberId?.trim().toUpperCase() || '';

    if (!normalized || normalized.length > 20) {
      return response(400, { success: false, error: '引荐码格式无效' });
    }

    const snapshot = await getAdminDb()
      .collection('users')
      .where('memberId', '==', normalized)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return response(404, { success: false, error: '引荐码不存在' });
    }

    const userDoc = snapshot.docs[0];
    return response(200, {
      success: true,
      user: {
        id: userDoc.id,
        memberId: normalized,
      },
    });
  } catch (error) {
    console.error('[lookup-member] Failed to query memberId:', error);
    return response(500, { success: false, error: '查询失败，请重试' });
  }
};
