// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectFirestoreEmulator, doc, getFirestore, terminate, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { executeDayPass } from '../functions/_shared/dayPass';

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8089';
const projectId = 'demo-daypass';
const apps: ReturnType<typeof initializeApp>[] = [];
const client = (uid: string) => {
  const app = initializeApp({ projectId, apiKey: 'emulator-only' }, `daypass-${uid}-${apps.length}`);
  apps.push(app);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8089, { mockUserToken: { sub: uid, email: `${uid}@example.com` } });
  return db;
};

describe.runIf(enabled)('Day Pass rules and concurrent transactions (isolated emulator)', () => {
  const app = enabled ? initializeAdmin({ projectId }, 'daypass-emulator-tests') : undefined;
  const db = app ? getAdminFirestore(app) : undefined;
  beforeEach(async () => {
    await fetch(`http://127.0.0.1:8089/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    await Promise.all([
      db!.doc('users/member').set({ role: 'guest', status: 'inactive', membership: { points: 200 } }),
      db!.doc('users/admin').set({ role: 'admin' }),
      db!.doc('users/developer').set({ role: 'developer' }),
      db!.doc('stores/lounge').set({ name: 'Lounge' }),
      db!.doc('config/points').set({ dayPass: { enabled: true, cost: 100, freeHours: 3, hourlyRateAfter: 30, cigarAllowance: 1 } }),
    ]);
  });
  afterAll(async () => {
    for (const app of apps) { await terminate(getFirestore(app)); await deleteApp(app); }
    if (app) await deleteAdmin(app);
  });
  it('serializes simultaneous requests into a single purchase', async () => {
    const input = { action: 'purchase', userId: 'member', storeId: 'lounge' };
    const results = await Promise.all([
      executeDayPass(db!, 'member', { ...input, requestId: 'first' }, Timestamp.now()),
      executeDayPass(db!, 'member', { ...input, requestId: 'second' }, Timestamp.now()),
    ]);
    expect(results[0].sessionId).toBe(results[1].sessionId);
    expect((await db!.doc('users/member').get()).data()?.membership.points).toBe(100);
    expect((await db!.collection('pointsRecords').get()).size).toBe(1);
    expect((await db!.collection('visitSessions').get()).size).toBe(1);
  }, 30000);
  it('blocks direct Day Pass creation by members and administrators', async () => {
    const session = { userId: 'member', storeId: 'lounge', status: 'pending', checkInType: 'daypass', dayPass: { isPurchased: true } };
    for (const uid of ['member', 'admin', 'developer']) {
      await expect(setDoc(doc(client(uid), 'visitSessions/forged'), session)).rejects.toMatchObject({ code: 'permission-denied' });
    }
  });
  it('blocks converting a visit or modifying a purchased price snapshot', async () => {
    await db!.doc('visitSessions/visit').set({ userId: 'member', storeId: 'lounge', status: 'pending' });
    const browser = client('admin');
    await expect(updateDoc(doc(browser, 'visitSessions/visit'), {
      checkInType: 'daypass', dayPass: { isPurchased: true },
    })).rejects.toMatchObject({ code: 'permission-denied' });
    await db!.doc('visitSessions/visit').update({ checkInType: 'daypass', dayPass: { isPurchased: true, config: { cost: 100 } } });
    await expect(updateDoc(doc(browser, 'visitSessions/visit'), { 'dayPass.config.cost': 1 }))
      .rejects.toMatchObject({ code: 'permission-denied' });
  });
  it('permits checkout of a purchased pass after disabling purchases', async () => {
    const result = await executeDayPass(db!, 'member', { action: 'purchase', userId: 'member', storeId: 'lounge', requestId: 'first' }, Timestamp.now());
    await executeDayPass(db!, 'developer', { action: 'set-enabled', enabled: false }, Timestamp.now());
    await expect(updateDoc(doc(client('member'), `visitSessions/${result.sessionId}`), {
      status: 'completed', checkOutAt: new Date(), pointsDeducted: 0,
    })).resolves.toBeUndefined();
    expect((await db!.doc(`visitSessions/${result.sessionId}`).get()).data()?.dayPass.config.cost).toBe(100);
  });
  it('requires the audited backend for toggles but permits pricing updates', async () => {
    for (const uid of ['admin', 'developer']) {
      const browser = client(uid);
      await expect(updateDoc(doc(browser, 'config/points'), { 'dayPass.enabled': false }))
        .rejects.toMatchObject({ code: 'permission-denied' });
      await expect(deleteDoc(doc(browser, 'config/points'))).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(updateDoc(doc(browser, 'config/points'), { 'dayPass.cost': 120 })).resolves.toBeUndefined();
    }
  });
});
