import type { Handler } from '@netlify/functions';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const response = (statusCode: number, body: Record<string, unknown>) => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

const initializeAdmin = () => {
  if (getApps().length) return;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
  }

  initializeApp({
    credential: cert(JSON.parse(serviceAccount)),
  });
};

const verifyCaller = async (authorization?: string) => {
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';

  if (!token) {
    throw new Error('UNAUTHENTICATED');
  }

  initializeAdmin();
  await getAuth().verifyIdToken(token);
};

const parseJsonResponse = (content: string) => {
  const cleaned = content
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  return JSON.parse(cleaned);
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return response(200, {});
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, error: 'Method not allowed' });
  }

  try {
    await verifyCaller(event.headers.authorization);

    const { query } = JSON.parse(event.body || '{}') as { query?: string };
    const normalizedQuery = query?.trim() || '';
    if (!normalizedQuery || normalizedQuery.length > 160) {
      return response(400, { success: false, error: 'Invalid cigar search query' });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return response(503, { success: false, error: 'Groq is not configured' });
    }

    const model = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_completion_tokens: 1400,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a cigar product specialist. Identify the product from a text query and correct obvious brand misspellings. Return only JSON. Never invent a professional rating. The name field must contain the cigar line/model/size without repeating the brand. Use this schema: {"brand":"","name":"","origin":"","size":null,"brandDescription":"","flavorProfile":[],"strength":"Unknown","wrapper":null,"binder":null,"filler":null,"footTasteNotes":null,"bodyTasteNotes":null,"headTasteNotes":null,"description":"","rating":null,"ratingSource":null,"confidence":0}. Confidence must be between 0 and 1.`,
          },
          {
            role: 'user',
            content: `Identify this cigar: ${normalizedQuery}`,
          },
        ],
      }),
    });

    if (!groqResponse.ok) {
      const detail = await groqResponse.text();
      console.error('[groq-cigar-search] Groq request failed:', groqResponse.status, detail);
      return response(502, { success: false, error: 'Groq search failed' });
    }

    const completion = await groqResponse.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return response(502, { success: false, error: 'Groq returned an empty result' });
    }

    const result = parseJsonResponse(content);
    if (!result.brand || !result.name) {
      return response(502, { success: false, error: 'Groq returned an incomplete result' });
    }

    return response(200, {
      success: true,
      provider: 'groq',
      model,
      result,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
      return response(401, { success: false, error: 'Authentication required' });
    }

    console.error('[groq-cigar-search] Failed:', error);
    return response(500, { success: false, error: 'Groq search failed' });
  }
};
