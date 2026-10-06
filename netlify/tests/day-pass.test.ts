// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), execute: vi.fn() }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], cert: vi.fn(), initializeApp: vi.fn() }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mocks.verify }) }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => ({}), Timestamp: { now: () => 'now' } }));
vi.mock('../functions/_shared/dayPass', () => ({ executeDayPass: mocks.execute }));
import { eventHandler as handler } from '../functions/day-pass';
const invoke = handler as unknown as (event: any) => Promise<{ statusCode: number; body: string }>;
const request = (changes = {}) => invoke({ httpMethod: 'POST', headers: { authorization: 'Bearer token' },
  body: JSON.stringify({ action: 'set-enabled', enabled: false }), ...changes });
describe('authenticated Day Pass endpoint', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.verify.mockResolvedValue({ uid: 'developer' }); mocks.execute.mockResolvedValue({ enabled: false }); });
  it('requires authentication before reading or changing data', async () => {
    expect((await request({ headers: {} })).statusCode).toBe(401);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('validates revoked tokens', async () => {
    mocks.verify.mockRejectedValue({ code: 'auth/id-token-revoked' });
    expect((await request()).statusCode).toBe(401);
    expect(mocks.verify).toHaveBeenCalledWith('token', true);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('rejects malformed requests and other methods', async () => {
    expect((await request({ httpMethod: 'GET' })).statusCode).toBe(405);
    expect((await request({ body: 'not json' })).statusCode).toBe(400);
    expect((await request({ body: 'null' })).statusCode).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('passes only verified identity to the transaction handler', async () => {
    expect((await request()).statusCode).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith({}, 'developer', { action: 'set-enabled', enabled: false }, 'now');
  });
  it('returns a disabled result instead of claiming a purchase succeeded', async () => {
    mocks.execute.mockRejectedValue(new Error('disabled'));
    const result = await request();
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body)).toEqual({ success: false, code: 'disabled' });
  });
  it('fails closed without exposing internal errors', async () => {
    mocks.execute.mockRejectedValue(new Error('database-internal-error'));
    const result = await request();
    expect(result.statusCode).toBe(503);
    expect(result.body).not.toContain('database-internal-error');
  });
});
