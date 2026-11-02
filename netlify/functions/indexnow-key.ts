import type { Handler } from '@netlify/functions';

const INDEXNOW_KEY = '130657a0b3814d2ba585346b261174df';

export const handler: Handler = async () => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  body: INDEXNOW_KEY,
});
