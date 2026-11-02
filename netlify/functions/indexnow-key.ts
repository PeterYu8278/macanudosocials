const INDEXNOW_KEY = '130657a0b3814d2ba585346b261174df';

export default async function handler() {
  return new Response(INDEXNOW_KEY, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' },
  });
}
