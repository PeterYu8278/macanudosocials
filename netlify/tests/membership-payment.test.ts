// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { GLOBAL_COLLECTIONS as C } from '../../src/config/globalCollections';

const m = vi.hoisted(() => ({ docs: new Map<string, any>(), db: null as any, post: vi.fn(), get: vi.fn(), auth: vi.fn(), counter: 0 }));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}] }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: m.auth }) }));
vi.mock('axios', () => ({ default: { post: m.post, get: m.get } }));
vi.mock('../functions/_shared/firestoreMonitoring', () => ({
  getFirestore: () => m.db,
  Timestamp: { now: () => new Date(), fromDate: (date: Date) => date },
  FieldValue: { serverTimestamp: () => new Date() },
  withFirestoreMonitoring: (_: string, work: () => unknown) => work(),
}));
import handler from '../functions/membership-payment';
import { fulfillMembershipPayment, handleMembershipBill } from '../functions/_shared/membershipPayment';
import { verifyXSignature } from '../functions/billplz-callback';

function database() {
  const snap = (path: string): any => ({ id: path.split('/').at(-1), exists: m.docs.has(path), data: () => m.docs.get(path), ref: ref(path) });
  const write = (path: string, values: any, merge = false) => {
    const data = merge ? structuredClone(m.docs.get(path) || {}) : {};
    for (const [key, value] of Object.entries(values)) {
      const fields = key.split('.'); let cursor = data;
      fields.slice(0, -1).forEach(field => { cursor = cursor[field] ||= {}; });
      cursor[fields.at(-1)!] = value;
    }
    m.docs.set(path, data);
  };
  const ref = (path: string): any => ({ path, id: path.split('/').at(-1), get: async () => snap(path), update: async (values: any) => write(path, values, true) });
  const collection = (path: string, filters: any[] = [], cap = Infinity): any => ({
    path, doc: (id = `order-${++m.counter}`) => ref(`${path}/${id}`),
    where: (key: string, _operator: string, value: any) => collection(path, [...filters, [key, value]], cap),
    limit: (value: number) => collection(path, filters, value),
    get: async () => {
      const docs = [...m.docs.keys()].filter(key => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1)
        .filter(key => filters.every(([field, value]) => m.docs.get(key)[field] === value)).slice(0, cap).map(snap);
      return { docs, empty: !docs.length, size: docs.length };
    },
  });
  let tail = Promise.resolve();
  return { doc: ref, collection,
    runTransaction: (work: any) => {
      const result = tail.then(async () => {
        const mutations: Array<() => void> = [];
        const output = await work({ get: (target: any) => target.get(),
          set: (target: any, data: any, options?: any) => mutations.push(() => write(target.path, data, options?.merge)),
          update: (target: any, data: any) => mutations.push(() => write(target.path, data, true)),
          delete: (target: any) => mutations.push(() => m.docs.delete(target.path)),
        });
        mutations.forEach(apply => apply()); return output;
      });
      tail = result.then(() => {}, () => {}); return result;
    },
  };
}

const request = (body?: any, query = '', token = 'valid') => handler(new Request(`http://localhost:3000/.netlify/functions/membership-payment${query}`, {
  method: body ? 'POST' : 'GET', headers: token ? { Authorization: `Bearer ${token}` } : {},
  ...(body && { body: JSON.stringify(body) }),
}));
const seedOrder = (renewal = false, reload = 200) => {
  m.docs.set(`${C.MEMBERSHIP_PAYMENTS}/payment`, {
    userId: 'user', annualFee: 150, reloadAmount: reload, totalCents: (150 + reload) * 100,
    renewalType: renewal ? 'renewal' : 'initial', storeId: 'store', status: 'pending', billplzId: 'bill', callbackProof: 'private-proof',
  });
  m.docs.set(`${C.MEMBERSHIP_PAYMENT_LOCKS}/user`, { orderId: 'payment' });
};

describe('Annual Pass payment', () => {
  beforeEach(() => {
    vi.clearAllMocks(); m.docs.clear(); m.counter = 0; m.db = database();
    m.auth.mockResolvedValue({ uid: 'user' });
    m.docs.set(`${C.USERS}/user`, { status: 'inactive', role: 'guest', displayName: 'Member', membership: { points: 80 } });
    m.docs.set(`${C.STORES}/store`, {});
    m.docs.set(`${C.CONFIG}/membershipFee`, { annualFees: [{ startDate: '2020-01-01', amount: 150 }] });
    m.docs.set(`${C.APP_CONFIG}/default`, { payment: { billplz: { enabled: true, apiKey: 'test', xSignatureKey: 'signature', collectionId: 'collection', isSandbox: true } } });
    m.post.mockImplementation(async (_url, body) => ({ data: { id: 'bill', url: 'https://www.billplz-sandbox.com/bills/bill', amount: body.amount } }));
  });
  it('requires authentication', async () => {
    expect((await request(undefined, '', '')).status).toBe(401);
    m.auth.mockRejectedValue(new Error('expired'));
    expect((await request()).status).toBe(401);
  });
  it('quotes first-time status using historical paid records, not role alone', async () => {
    expect(await (await request()).json()).toMatchObject({ annualFee: 150, renewal: false });
    m.docs.set(`${C.MEMBERSHIP_FEE_RECORDS}/old`, { userId: 'user', status: 'paid' });
    expect(await (await request()).json()).toMatchObject({ renewal: true });
  });
  it('rejects fee-only first activation and arbitrary recharge amounts', async () => {
    for (const reloadAmount of [0, 300, -1, '200']) {
      expect((await request({ reloadAmount, storeId: 'store' })).status).toBe(409);
    }
    expect(m.post).not.toHaveBeenCalled();
  });
  it.each([100, 200, 500])('accepts RM%s recharge plus the annual fee', async reloadAmount => {
    expect((await request({ reloadAmount, storeId: 'store' })).status).toBe(200);
    expect(m.post.mock.calls[0][1]).toMatchObject({ amount: (reloadAmount + 150) * 100 });
  });
  it('creates RM350 on the server and reuses an existing checkout', async () => {
    expect((await request({ reloadAmount: 200, storeId: 'store', annualFee: 1 })).status).toBe(200);
    expect(m.post.mock.calls[0][1]).toMatchObject({ amount: 35000 });
    expect(await (await request({ reloadAmount: 200, storeId: 'store' })).json()).toMatchObject({ resumed: true });
    expect(m.post).toHaveBeenCalledTimes(1);
    m.docs.get(`${C.CONFIG}/membershipFee`).annualFees[0].amount = 180;
    expect(await (await request()).json()).toMatchObject({ annualFee: 150, reloadAmount: 200, pending: true });
  });
  it('allows fee-only payment after historical activation', async () => {
    m.docs.get(`${C.USERS}/user`).membership.activeUntil = '2025-01-01';
    expect((await request({ reloadAmount: 0, storeId: 'store' })).status).toBe(200);
    expect(m.post.mock.calls[0][1]).toMatchObject({ amount: 15000 });
  });
  it('rejects active, suspended and invalid-store checkouts', async () => {
    expect((await request({ reloadAmount: 200, storeId: 'missing' })).status).toBe(409);
    for (const status of ['active', 'suspended']) {
      m.docs.get(`${C.USERS}/user`).status = status;
      expect((await request({ reloadAmount: 200, storeId: 'store' })).status).toBe(409);
    }
    expect(m.post).not.toHaveBeenCalled();
  });
  it('credits reload plus fee, deducts the fee, and activates one year atomically', async () => {
    seedOrder();
    await fulfillMembershipPayment(m.db, 'payment', 'bill', 35000);
    const user = m.docs.get(`${C.USERS}/user`);
    expect(user).toMatchObject({ status: 'active', role: 'vip', membership: { points: 280 } });
    expect(user.membership.activeUntil.getFullYear()).toBe(user.membership.activeFrom.getFullYear() + 1);
    expect(user.membership.nextFirstVisitWaiverExpiresAt).toBeUndefined();
    expect(m.docs.get(`${C.POINTS_RECORDS}/membership_payment_credit`).amount).toBe(350);
    expect(m.docs.get(`${C.POINTS_RECORDS}/membership_payment_fee`).amount).toBe(150);
    expect(m.docs.has(`${C.MEMBERSHIP_PAYMENT_LOCKS}/user`)).toBe(false);
  });
  it('fee-only renewal preserves wallet and records renewal waiver', async () => {
    seedOrder(true, 0);
    m.docs.set(`${C.MEMBERSHIP_FEE_RECORDS}/due`, { userId: 'user', status: 'pending', renewalType: 'renewal' });
    await fulfillMembershipPayment(m.db, 'payment', 'bill', 15000);
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(80);
    expect(m.docs.get(`${C.USERS}/user`).membership.nextFirstVisitWaiverExpiresAt).toBeInstanceOf(Date);
    expect(m.docs.get(`${C.MEMBERSHIP_FEE_RECORDS}/due`).status).toBe('paid');
    expect(m.docs.has(`${C.RELOAD_RECORDS}/membership_payment`)).toBe(false);
  });
  it('handles a signed callback even when bill creation has not persisted the bill ID yet', async () => {
    seedOrder();
    const order = m.docs.get(`${C.MEMBERSHIP_PAYMENTS}/payment`);
    order.status = 'creating'; delete order.billplzId;
    await expect(handleMembershipBill(m.db, 'bill', 35000, true, 'payment', 'wrong-proof')).rejects.toThrow('INVALID_PAYMENT_BINDING');
    expect(await handleMembershipBill(m.db, 'bill', 35000, true, 'payment', 'private-proof')).toBe(true);
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(280);
    expect(order.status).toBe('creating');
    expect(m.docs.get(`${C.MEMBERSHIP_PAYMENTS}/payment`)).toMatchObject({ status: 'fulfilled', billplzId: 'bill' });
  });
  it('handles parallel and sequential replay without duplicate credits or annual fees', async () => {
    seedOrder();
    await Promise.all([1, 2, 3].map(() => fulfillMembershipPayment(m.db, 'payment', 'bill', 35000)));
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(280);
    expect([...m.docs.keys()].filter(key => key.startsWith(`${C.POINTS_RECORDS}/`))).toHaveLength(2);
  });
  it('verifies key+value signatures and rejects the old values-only format', () => {
    const params = new URLSearchParams({ id: 'bill', paid: 'true', paid_amount: '35000', amount: '35000' });
    params.set('x_signature', createHmac('sha256', 'secret').update('amount35000|idbill|paid_amount35000|paidtrue').digest('hex'));
    expect(verifyXSignature(params, 'secret')).toBe(true);
    params.set('amount', '1');
    expect(verifyXSignature(params, 'secret')).toBe(false);
    params.set('amount', '35000');
    params.set('x_signature', createHmac('sha256', 'secret').update('35000|bill|35000|true').digest('hex'));
    expect(verifyXSignature(params, 'secret')).toBe(false);
  });
  it('rejects wrong bill, wrong amount and wrong signature without writes', async () => {
    seedOrder();
    await expect(fulfillMembershipPayment(m.db, 'payment', 'wrong', 35000)).rejects.toThrow('PAYMENT_AMOUNT_MISMATCH');
    await expect(fulfillMembershipPayment(m.db, 'payment', 'bill', 1)).rejects.toThrow('PAYMENT_AMOUNT_MISMATCH');
    await expect(handleMembershipBill(m.db, 'bill', 35000, false)).rejects.toThrow('INVALID_PAYMENT_SIGNATURE');
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(80);
  });
  it('credits the full payment if the user became active without charging a second year', async () => {
    seedOrder(); m.docs.get(`${C.USERS}/user`).status = 'active';
    expect(await fulfillMembershipPayment(m.db, 'payment', 'bill', 35000)).toBe('credited');
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(430);
    expect(m.docs.has(`${C.POINTS_RECORDS}/membership_payment_fee`)).toBe(false);
  });
  it('recovers delayed callbacks via verified gateway status and rejects other users orders', async () => {
    seedOrder(true, 0);
    m.get.mockResolvedValue({ data: { id: 'bill', amount: 15000, paid_amount: 15000, paid: true } });
    expect(await (await request(undefined, '?order=payment')).json()).toMatchObject({ status: 'fulfilled' });
    m.docs.get(`${C.MEMBERSHIP_PAYMENTS}/payment`).userId = 'someone-else';
    expect((await request(undefined, '?order=payment')).status).toBe(409);
  });
});
