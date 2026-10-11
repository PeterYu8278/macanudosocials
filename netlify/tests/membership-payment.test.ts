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
import reviewHandler from '../functions/reload-review';
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
const review = (body: any, token = 'valid') => reviewHandler(new Request('http://localhost:3000/.netlify/functions/reload-review', {
  method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
}));
const manualPackage = async () => {
  m.docs.get(`${C.APP_CONFIG}/default`).payment.billplz.enabled = false;
  const payment = await (await request({ reloadAmount: 100, storeId: 'store' })).json();
  m.docs.set(`${C.USERS}/operator`, { role: 'storeAdmin', storeId: 'store', displayName: 'Staff' });
  m.auth.mockResolvedValue({ uid: 'operator' });
  return { recordId: `membership_${payment.orderId}`, orderId: payment.orderId, action: 'approve', actualAmount: 250, proof: 'https://receipt.example/image.png' };
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
  it('uses manual requests when Billplz is explicitly disabled without creating a bill or changing points', async () => {
    m.docs.get(`${C.APP_CONFIG}/default`).payment.billplz = { enabled: false };
    expect(await (await request()).json()).toMatchObject({ paymentMethod: 'manual', paymentAvailable: true });
    const first = await (await request({ reloadAmount: 100, storeId: 'store' })).json();
    const second = await (await request({ reloadAmount: 100, storeId: 'store' })).json();
    expect(first.paymentMethod).toBe('manual');
    expect(second).toMatchObject({ orderId: first.orderId, resumed: true });
    expect(m.docs.get(`${C.RELOAD_RECORDS}/membership_${first.orderId}`)).toMatchObject({ status: 'pending', requestedAmount: 250, walletAmount: 100 });
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(80);
    expect(m.post).not.toHaveBeenCalled();
    expect(await (await request(undefined, `?order=${first.orderId}`)).json()).toMatchObject({ status: 'pending' });
    expect(m.get).not.toHaveBeenCalled();
  });
  it('does not convert an existing online bill to manual after disabling the gateway', async () => {
    const initial = await (await request({ reloadAmount: 100, storeId: 'store' })).json();
    m.docs.get(`${C.APP_CONFIG}/default`).payment.billplz.enabled = false;
    expect(await (await request()).json()).toMatchObject({ paymentMethod: 'billplz', pending: true, paymentAvailable: true });
    expect(await (await request({ reloadAmount: 100, storeId: 'store' })).json()).toMatchObject({ orderId: initial.orderId, paymentUrl: initial.paymentUrl });
    expect(m.post).toHaveBeenCalledTimes(1);
  });
  it('settles the manual package once with an annual fee debit and net RM100 credit', async () => {
    const body = await manualPackage();
    const responses = await Promise.all([review(body), review(body)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(m.docs.get(`${C.USERS}/user`)).toMatchObject({ role: 'vip', status: 'active', membership: { points: 180, nextFirstVisitWaiverExpiresAt: null } });
    expect(m.docs.get(`${C.RELOAD_RECORDS}/${body.recordId}`)).toMatchObject({ status: 'completed', verifiedBy: 'operator', actualAmount: 250 });
    expect(m.docs.get(`${C.MEMBERSHIP_PAYMENTS}/${body.orderId}`).status).toBe('fulfilled');
    expect(m.docs.has(`${C.MEMBERSHIP_PAYMENT_LOCKS}/user`)).toBe(false);
    expect([...m.docs.values()].filter(value => value.source === 'membership_fee')).toHaveLength(1);
  });
  it.each(['missingProof', 'amountMismatch', 'wrongStore', 'memberRole', 'active', 'suspended'])('blocks invalid manual approval: %s', async failure => {
    const body = await manualPackage();
    if (failure === 'missingProof') body.proof = '';
    if (failure === 'amountMismatch') body.actualAmount = 100;
    if (failure === 'wrongStore') m.docs.get(`${C.USERS}/operator`).storeId = 'other';
    if (failure === 'memberRole') m.docs.get(`${C.USERS}/operator`).role = 'member';
    if (['active', 'suspended'].includes(failure)) m.docs.get(`${C.USERS}/user`).status = failure;
    expect((await review(body)).status).toBe(['wrongStore', 'memberRole'].includes(failure) ? 403 : 409);
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(80);
    expect(m.docs.get(`${C.RELOAD_RECORDS}/${body.recordId}`).status).toBe('pending');
  });
  it('keeps the requested annual fee snapshot even when configuration changes before review', async () => {
    const body = await manualPackage();
    m.docs.get(`${C.CONFIG}/membershipFee`).annualFees[0].amount = 199;
    expect((await review(body)).status).toBe(200);
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(180);
  });
  it.each(['active', 'suspended'])('requires explicit credit-only reconciliation for a now %s account', async status => {
    const body = await manualPackage();
    m.docs.get(`${C.USERS}/user`).status = status;
    expect((await review({ ...body, creditOnly: true })).status).toBe(200);
    expect(m.docs.get(`${C.USERS}/user`)).toMatchObject({ status, membership: { points: 330 } });
    expect(m.docs.get(`${C.MEMBERSHIP_PAYMENTS}/${body.orderId}`).status).toBe('credited');
    expect([...m.docs.values()].filter(value => value.source === 'membership_fee')).toHaveLength(0);
  });
  it('rejects fake gateway fulfillment for a manual package', async () => {
    const body = await manualPackage();
    await expect(fulfillMembershipPayment(m.db, body.orderId, 'fake', 25000)).rejects.toThrow('INVALID_PAYMENT_METHOD');
  });
  it('cancels a pending package atomically and prevents subsequent approval', async () => {
    const body = await manualPackage();
    m.auth.mockResolvedValue({ uid: 'user' });
    expect((await review({ ...body, action: 'cancel' })).status).toBe(200);
    m.auth.mockResolvedValue({ uid: 'operator' });
    expect((await review(body)).status).toBe(409);
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(80);
    expect(m.docs.get(`${C.MEMBERSHIP_PAYMENTS}/${body.orderId}`).status).toBe('cancelled');
    expect(m.docs.has(`${C.MEMBERSHIP_PAYMENT_LOCKS}/user`)).toBe(false);
  });
  it('serializes rejection versus approval without a partial wallet update', async () => {
    const body = await manualPackage();
    const responses = await Promise.all([review({ ...body, action: 'reject' }), review(body)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const record = m.docs.get(`${C.RELOAD_RECORDS}/${body.recordId}`);
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(record.status === 'completed' ? 180 : 80);
  });
  it('serializes owner cancellation versus staff approval', async () => {
    const body = await manualPackage();
    m.auth.mockImplementation(async token => ({ uid: token === 'owner-token' ? 'user' : 'operator' }));
    const results = await Promise.all([review({ ...body, action: 'cancel' }, 'owner-token'), review(body, 'staff-token')]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const completed = m.docs.get(`${C.RELOAD_RECORDS}/${body.recordId}`).status === 'completed';
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(completed ? 180 : 80);
    expect(m.docs.has(`${C.MEMBERSHIP_PAYMENT_LOCKS}/user`)).toBe(false);
  });
  it('does not allow a suspended operator to approve a package', async () => {
    const body = await manualPackage();
    m.docs.get(`${C.USERS}/operator`).status = 'suspended';
    expect((await review(body)).status).toBe(403);
  });
  it.each([20, 80])('renews after a reload only when the final balance covers the annual fee (old points %s)', async points => {
    m.docs.get(`${C.USERS}/user`).membership.points = points;
    m.docs.set(`${C.MEMBERSHIP_FEE_RECORDS}/paid`, { userId: 'user', status: 'paid', amount: 150 });
    m.docs.set(`${C.RELOAD_RECORDS}/ordinary`, { userId: 'user', storeId: 'store', requestedAmount: 100, pointsEquivalent: 100, status: 'pending' });
    m.docs.set(`${C.USERS}/operator`, { role: 'admin', displayName: 'Staff' });
    m.auth.mockResolvedValue({ uid: 'operator' });
    expect((await review({ action: 'approve', recordId: 'ordinary', actualAmount: 100 })).status).toBe(200);
    expect(m.docs.get(`${C.USERS}/user`)).toMatchObject({ status: points === 80 ? 'active' : 'inactive', membership: { points: points === 80 ? 30 : 120 } });
  });
  it('never activates a first pass from an ordinary RM299 reload', async () => {
    m.docs.set(`${C.RELOAD_RECORDS}/ordinary`, { userId: 'user', storeId: 'store', requestedAmount: 299, pointsEquivalent: 299, status: 'pending' });
    m.docs.set(`${C.USERS}/operator`, { role: 'admin' }); m.auth.mockResolvedValue({ uid: 'operator' });
    expect((await review({ action: 'approve', recordId: 'ordinary' })).status).toBe(200);
    expect(m.docs.get(`${C.USERS}/user`)).toMatchObject({ role: 'member', status: 'inactive', membership: { points: 379 } });
  });
  it('awards configured first reload referral bonuses once alongside package settlement', async () => {
    m.docs.get(`${C.USERS}/user`).referral = { referredByUserId: 'referrer' };
    m.docs.set(`${C.USERS}/referrer`, { membership: { points: 10 }, referral: { referrals: [] } });
    m.docs.set(`${C.CONFIG}/points`, { reload: { referrerFirstReload: 20, referredFirstReload: 5 } });
    const body = await manualPackage();
    await review(body); await review(body);
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(185);
    expect(m.docs.get(`${C.USERS}/referrer`).membership.points).toBe(30);
  });
  it('rejects manual approval of an online reload and requires auth', async () => {
    m.docs.set(`${C.RELOAD_RECORDS}/online`, { userId: 'user', storeId: 'store', billplzId: 'bill', status: 'pending' });
    m.docs.set(`${C.USERS}/operator`, { role: 'admin' }); m.auth.mockResolvedValue({ uid: 'operator' });
    expect((await review({ action: 'approve', recordId: 'online' })).status).toBe(409);
    expect((await review({ action: 'approve', recordId: 'online' }, '')).status).toBe(401);
  });
  it('validates self reload options and refuses a duplicate pending request', async () => {
    m.docs.get(`${C.APP_CONFIG}/default`).payment.billplz.enabled = false;
    expect((await review({ action: 'create', userId: 'user', storeId: 'store', amount: 300 })).status).toBe(403);
    expect((await review({ action: 'create', userId: 'user', storeId: 'store', amount: 100 })).status).toBe(200);
    expect((await review({ action: 'create', userId: 'user', storeId: 'store', amount: 200 })).status).toBe(409);
  });
  it.each(['apiKey', 'collectionId', 'xSignatureKey'])('reports missing %s without creating an order or leaking configuration values', async field => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete m.docs.get(`${C.APP_CONFIG}/default`).payment.billplz[field];
    try {
      expect(await (await request()).json()).toMatchObject({ paymentAvailable: false });
      const response = await request({ reloadAmount: 100, storeId: 'store' });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'PAYMENT_CONFIGURATION_INCOMPLETE' });
      expect(log).toHaveBeenCalledWith('[membership-payment] Failed', {
        stage: 'validate_gateway', method: 'POST', code: 'PAYMENT_CONFIGURATION_INCOMPLETE', configurationIssues: [field],
      });
      expect(m.post).not.toHaveBeenCalled();
      expect(m.docs.has(`${C.MEMBERSHIP_PAYMENT_LOCKS}/user`)).toBe(false);
      expect(JSON.stringify(log.mock.calls)).not.toContain('signature');
    } finally { log.mockRestore(); }
  });
  it('does not redirect member payments to the platform subscription gateway', async () => {
    const config = m.docs.get(`${C.APP_CONFIG}/default`);
    config.paymentPlatform = structuredClone(config.payment);
    delete config.payment;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await (await request()).json()).toMatchObject({ paymentAvailable: true, paymentMethod: 'manual' });
      expect(await (await request({ reloadAmount: 100, storeId: 'store' })).json()).toMatchObject({ success: true, paymentMethod: 'manual' });
      expect(m.post).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it.each(['enabled', 'billplz', 'payment', 'appConfig'])('defaults to manual Annual Pass handling when %s is missing', async missing => {
    const config = m.docs.get(`${C.APP_CONFIG}/default`);
    if (missing === 'enabled') delete config.payment.billplz.enabled;
    if (missing === 'billplz') delete config.payment.billplz;
    if (missing === 'payment') delete config.payment;
    if (missing === 'appConfig') m.docs.delete(`${C.APP_CONFIG}/default`);
    expect(await (await request()).json()).toMatchObject({ paymentAvailable: true, paymentMethod: 'manual' });
    const payment = await (await request({ reloadAmount: 100, storeId: 'store' })).json();
    expect(payment).toMatchObject({ success: true, paymentMethod: 'manual' });
    expect(m.docs.get(`${C.RELOAD_RECORDS}/membership_${payment.orderId}`)).toMatchObject({ status: 'pending', requestedAmount: 250, walletAmount: 100 });
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(80);
    expect(m.post).not.toHaveBeenCalled();
  });
  it('allows manual renewal reload requests when payment configuration is missing', async () => {
    delete m.docs.get(`${C.APP_CONFIG}/default`).payment;
    m.docs.set(`${C.MEMBERSHIP_FEE_RECORDS}/paid`, { userId: 'user', status: 'paid', amount: 150 });
    const payment = await (await request({ reloadAmount: 100, storeId: 'store' })).json();
    expect(payment.paymentMethod).toBe('manual');
    expect(m.docs.get(`${C.RELOAD_RECORDS}/membership_${payment.orderId}`)).toMatchObject({ requestedAmount: 100, annualFeeAmount: 0, paymentPurpose: 'renewal_reload' });
    expect(m.post).not.toHaveBeenCalled();
  });
  it('allows ordinary manual reloads with an unset Billplz toggle but blocks them when explicitly enabled', async () => {
    delete m.docs.get(`${C.APP_CONFIG}/default`).payment.billplz.enabled;
    expect((await review({ action: 'create', userId: 'user', storeId: 'store', amount: 100 })).status).toBe(200);
    m.docs.get(`${C.APP_CONFIG}/default`).payment.billplz.enabled = true;
    expect((await review({ action: 'create', userId: 'user', storeId: 'store', amount: 200 })).status).toBe(403);
  });
  it('reports a ready gateway without exposing keys in the quote', async () => {
    const quote = await (await request()).json();
    expect(quote.paymentAvailable).toBe(true);
    expect(quote).not.toHaveProperty('apiKey');
    expect(quote).not.toHaveProperty('xSignatureKey');
  });
  it('rejects blank credentials rather than creating a doomed invoice', async () => {
    m.docs.get(`${C.APP_CONFIG}/default`).payment.billplz.apiKey = '   ';
    expect(await (await request()).json()).toMatchObject({ paymentAvailable: false });
  });
  it('logs the failing gateway stage without exposing credentials and retains the reservation', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    m.post.mockRejectedValueOnce(Object.assign(new Error('secret customer token'), {
      code: 'ERR_BAD_REQUEST', response: { status: 422, data: { secret: 'private' } },
    }));
    try {
      expect((await request({ reloadAmount: 100, storeId: 'store' })).status).toBe(503);
      expect(log).toHaveBeenCalledWith('[membership-payment] Failed', {
        stage: 'create_bill', method: 'POST', code: 'ERR_BAD_REQUEST', upstreamStatus: 422,
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
      expect(m.docs.has(`${C.MEMBERSHIP_PAYMENT_LOCKS}/user`)).toBe(true);
      expect((await request({ reloadAmount: 100, storeId: 'store' })).status).toBe(409);
      expect(m.post).toHaveBeenCalledTimes(1);
    } finally { log.mockRestore(); }
  });
  it('marks an expired active membership inactive without debiting the wallet', async () => {
    m.docs.get(`${C.USERS}/user`).status = 'active';
    m.docs.get(`${C.USERS}/user`).membership.activeUntil = new Date(Date.now() - 86400000);
    m.docs.set(`${C.MEMBERSHIP_FEE_RECORDS}/old`, { userId: 'user', status: 'paid', amount: 150 });
    expect(await (await request()).json()).toMatchObject({ accountStatus: 'inactive', renewal: true });
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(80);
    expect(m.post).not.toHaveBeenCalled();
  });
  it('restores a paid unexpired membership without another annual charge', async () => {
    const from = new Date(Date.now() - 86400000);
    const until = new Date(from); until.setFullYear(until.getFullYear() + 1);
    m.docs.get(`${C.USERS}/user`).membership = { points: 80, activeFrom: from, activeUntil: until };
    m.docs.set(`${C.MEMBERSHIP_FEE_RECORDS}/paid`, { userId: 'user', status: 'paid', amount: 199, deductedAt: from });
    expect(await (await request()).json()).toMatchObject({ accountStatus: 'active' });
    expect(m.docs.get(`${C.USERS}/user`)).toMatchObject({ status: 'active', role: 'vip', membership: { points: 80 } });
    expect([...m.docs.keys()].filter(path => path.startsWith(`${C.POINTS_RECORDS}/`))).toHaveLength(0);
  });
  it('does not grant access based on future dates without matching paid evidence', async () => {
    m.docs.get(`${C.USERS}/user`).membership.activeFrom = new Date(Date.now() - 86400000);
    m.docs.get(`${C.USERS}/user`).membership.activeUntil = new Date(Date.now() + 86400000);
    m.docs.set(`${C.MEMBERSHIP_FEE_RECORDS}/old`, { userId: 'user', status: 'paid', amount: 199, deductedAt: new Date('2020-01-01') });
    const response = await request();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'MEMBERSHIP_STATUS_UNVERIFIED' });
    expect(m.docs.get(`${C.USERS}/user`)).toMatchObject({ status: 'inactive', membership: { points: 80 } });
  });
  it('never restores a suspended account during a quote check', async () => {
    m.docs.get(`${C.USERS}/user`).status = 'suspended';
    m.docs.get(`${C.USERS}/user`).membership.activeUntil = new Date(Date.now() + 86400000);
    expect(await (await request()).json()).toMatchObject({ accountStatus: 'suspended' });
    expect(m.docs.get(`${C.USERS}/user`).status).toBe('suspended');
  });
  it('quotes first-time status using historical paid records, not role alone', async () => {
    expect(await (await request()).json()).toMatchObject({ annualFee: 150, renewal: false });
    m.docs.set(`${C.MEMBERSHIP_FEE_RECORDS}/old`, { userId: 'user', status: 'paid', amount: 150 });
    expect(await (await request()).json()).toMatchObject({ renewal: true });
  });
  it('does not treat placeholder dates or an unpaid record as successful activation', async () => {
    m.docs.get(`${C.USERS}/user`).membership = {
      points: 500, activeFrom: '2025-01-01', activeUntil: '2026-01-01', firstActivatedAt: '2025-01-01',
    };
    m.docs.set(`${C.MEMBERSHIP_FEE_RECORDS}/pending`, { userId: 'user', status: 'pending', amount: 150 });
    expect(await (await request()).json()).toMatchObject({ renewal: false });
    expect((await request({ reloadAmount: 100, storeId: 'store' })).status).toBe(200);
    expect(m.post.mock.calls[0][1].amount).toBe(25000);
  });
  it('rejects fee-only first activation and arbitrary recharge amounts', async () => {
    for (const reloadAmount of [0, 200, 300, 500, -1, '100']) {
      expect((await request({ reloadAmount, storeId: 'store' })).status).toBe(409);
    }
    expect(m.post).not.toHaveBeenCalled();
  });
  it.each([100, 200, 500])('charges only RM%s recharge for renewal', async reloadAmount => {
    m.docs.get(`${C.USERS}/user`).membership.activeFrom = '2025-01-01';
    m.docs.set(`${C.MEMBERSHIP_FEE_RECORDS}/old`, { userId: 'user', status: 'paid', amount: 150 });
    expect((await request({ reloadAmount, storeId: 'store' })).status).toBe(200);
    expect(m.post.mock.calls[0][1]).toMatchObject({ amount: reloadAmount * 100 });
  });
  it('creates the fixed RM100 plus fee package even with sufficient points and reuses it', async () => {
    m.docs.get(`${C.USERS}/user`).membership.points = 1000;
    expect((await request({ reloadAmount: 100, storeId: 'store', annualFee: 1 })).status).toBe(200);
    expect(m.post.mock.calls[0][1]).toMatchObject({ amount: 25000 });
    expect(await (await request({ reloadAmount: 100, storeId: 'store' })).json()).toMatchObject({ resumed: true });
    expect(m.post).toHaveBeenCalledTimes(1);
    m.docs.get(`${C.CONFIG}/membershipFee`).annualFees[0].amount = 180;
    expect(await (await request()).json()).toMatchObject({ annualFee: 150, reloadAmount: 100, pending: true });
  });
  it('rejects fee-only payment after historical activation', async () => {
    m.docs.get(`${C.USERS}/user`).membership.activeUntil = '2025-01-01';
    expect((await request({ reloadAmount: 0, storeId: 'store' })).status).toBe(409);
    expect(m.post).not.toHaveBeenCalled();
  });
  it('uses the configured RM199 annual fee for a RM299 first package', async () => {
    m.docs.get(`${C.CONFIG}/membershipFee`).annualFees[0].amount = 199;
    expect((await request({ reloadAmount: 100, storeId: 'store' })).status).toBe(200);
    expect(m.post.mock.calls[0][1]).toMatchObject({ amount: 29900 });
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
  it('honors a legacy fee-only bill without granting a renewal waiver', async () => {
    seedOrder(true, 0);
    m.docs.set(`${C.MEMBERSHIP_FEE_RECORDS}/due`, { userId: 'user', status: 'pending', renewalType: 'renewal' });
    await fulfillMembershipPayment(m.db, 'payment', 'bill', 15000);
    expect(m.docs.get(`${C.USERS}/user`).membership.points).toBe(80);
    expect(m.docs.get(`${C.USERS}/user`).membership.nextFirstVisitWaiverExpiresAt).toBeNull();
    expect(m.docs.get(`${C.MEMBERSHIP_FEE_RECORDS}/due`).status).toBe('paid');
    expect(m.docs.has(`${C.RELOAD_RECORDS}/membership_payment`)).toBe(false);
  });
  it('renews from existing balance plus RM100 reload without charging the fee externally', async () => {
    m.docs.get(`${C.USERS}/user`).membership = { points: 101, activeUntil: '2025-01-01', nextFirstVisitWaiverExpiresAt: new Date() };
    m.docs.set(`${C.MEMBERSHIP_FEE_RECORDS}/old`, { userId: 'user', status: 'paid', amount: 199 });
    m.docs.get(`${C.CONFIG}/membershipFee`).annualFees[0].amount = 199;
    const result = await (await request({ reloadAmount: 100, storeId: 'store' })).json();
    expect(m.post.mock.calls[0][1].amount).toBe(10000);
    await Promise.all([1, 2].map(() => fulfillMembershipPayment(m.db, result.orderId, 'bill', 10000)));
    expect(m.docs.get(`${C.USERS}/user`)).toMatchObject({ status: 'active', role: 'vip', membership: { points: 2, nextFirstVisitWaiverExpiresAt: null } });
    expect(m.docs.get(`${C.POINTS_RECORDS}/membership_${result.orderId}_fee`).amount).toBe(199);
    expect(m.docs.get(`${C.RELOAD_RECORDS}/membership_${result.orderId}`).requestedAmount).toBe(100);
  });
  it('credits an insufficient reload once without renewing, then permits a second reload', async () => {
    m.docs.set(`${C.MEMBERSHIP_FEE_RECORDS}/old`, { userId: 'user', status: 'paid', amount: 199 });
    m.docs.get(`${C.USERS}/user`).membership.activeUntil = '2025-01-01';
    m.docs.get(`${C.CONFIG}/membershipFee`).annualFees[0].amount = 199;
    const first = await (await request({ reloadAmount: 100, storeId: 'store' })).json();
    await fulfillMembershipPayment(m.db, first.orderId, 'bill', 10000);
    await fulfillMembershipPayment(m.db, first.orderId, 'bill', 10000);
    expect(m.docs.get(`${C.USERS}/user`)).toMatchObject({ status: 'inactive', membership: { points: 180 } });
    expect(m.docs.get(`${C.MEMBERSHIP_PAYMENTS}/${first.orderId}`).status).toBe('credited');
    expect(m.docs.has(`${C.POINTS_RECORDS}/membership_${first.orderId}_fee`)).toBe(false);
    const second = await (await request({ reloadAmount: 100, storeId: 'store' })).json();
    expect(second.orderId).not.toBe(first.orderId);
    await fulfillMembershipPayment(m.db, second.orderId, 'bill', 10000);
    expect(m.docs.get(`${C.USERS}/user`)).toMatchObject({ status: 'active', membership: { points: 81 } });
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
