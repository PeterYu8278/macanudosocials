// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectFirestoreEmulator, doc, getFirestore, terminate, setDoc, updateDoc } from 'firebase/firestore';
import { checkInLounge, settleLoungeVisit } from '../functions/_shared/loungeVisits';
import { emptyLoungeOperations } from '../../src/utils/loungeOperations';

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8089';
const projectId = 'demo-lounge';
const apps: ReturnType<typeof initializeApp>[] = [];
const at = (hour: number) => new Date(`2026-10-15T${String(hour).padStart(2, '0')}:00:00+08:00`);
const client = (uid: string) => {
  const app = initializeApp({ projectId, apiKey: 'emulator-only' }, `lounge-${uid}-${apps.length}`); apps.push(app);
  const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8089, { mockUserToken: { sub: uid } }); return db;
};

describe.runIf(enabled)('lounge rules and real concurrent transactions (isolated emulator)', () => {
  const app = enabled ? initializeAdmin({ projectId }, 'lounge-emulator-tests') : undefined;
  const db = app ? getAdminFirestore(app) : undefined;
  beforeEach(async () => {
    await fetch(`http://127.0.0.1:8089/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    await Promise.all([
      db!.doc('users/member').set({ role: 'member', status: 'active', membership: { points: 30, totalVisitHours: 0 } }),
      db!.doc('users/operator').set({ role: 'developer', status: 'active' }),
      db!.doc('stores/lounge').set({ name: 'Lounge', status: 'active', operations: { ...emptyLoungeOperations(), enabled: true,
        week: Array.from({ length: 7 }, () => ({ open: true, startsAt: '12:00' })) } }),
      db!.doc('stores/legacy').set({ name: 'Legacy', status: 'active' }),
      db!.doc('config/membershipFee').set({ annualFees: [{ startDate: Timestamp.fromDate(at(0)), rate: 20 }] }),
      db!.doc('config/points').set({ purchase: { rebatePercent: 0 } }),
    ]);
  });
  afterAll(async () => {
    for (const app of apps) { await terminate(getFirestore(app)); await deleteApp(app); }
    if (app) await deleteAdmin(app);
  });
  const input = { userId: 'member', storeId: 'lounge', requestId: 'request' };
  it('serializes competing check-ins, manual checkout and automatic checkout', async () => {
    await Promise.all([checkInLounge(db!, 'member', input, at(20)), checkInLounge(db!, 'member', input, at(20))]);
    expect((await db!.doc('users/member').get()).data()?.membership.points).toBe(10);
    await Promise.all([
      settleLoungeVisit(db!, 'checkin_member_request', at(23), { automatic: true }),
      settleLoungeVisit(db!, 'checkin_member_request', at(23), { uid: 'operator' }),
    ]);
    expect((await db!.doc('users/member').get()).data()?.membership.points).toBe(-40);
    expect((await db!.collection('pointsRecords').get()).size).toBe(2);
    expect((await db!.collection('audit_logs').get()).size).toBe(1);
  }, 20000);
  it('denies direct managed check-ins, financial updates and client hours edits', async () => {
    const member = client('member'), operator = client('operator');
    await expect(setDoc(doc(member, 'visitSessions/bypass'), { userId: 'member', storeId: 'lounge', status: 'pending', checkInAt: new Date() })).rejects.toMatchObject({ code: 'permission-denied' });
    await checkInLounge(db!, 'member', input, at(20));
    await expect(updateDoc(doc(operator, 'visitSessions/checkin_member_request'), { status: 'completed' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(operator, 'users/member'), { 'membership.points': -99, 'membership.currentVisitSessionId': null })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(operator, 'stores/lounge'), { 'operations.enabled': false })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(updateDoc(doc(member, 'users/member'), { displayName: 'Updated' })).resolves.toBeUndefined();
    // Unrelated wallet consumption retains its existing permissions and leaves the visit pointer intact.
    await expect(updateDoc(doc(member, 'users/member'), { 'membership.points': 5 })).resolves.toBeUndefined();
    await expect(updateDoc(doc(operator, 'stores/lounge'), { name: 'Updated' })).resolves.toBeUndefined();
  }, 15000);
  it('denies new member redemption claims after the persisted cutoff', async () => {
    await checkInLounge(db!, 'member', input, at(20));
    await db!.doc('visitSessions/checkin_member_request').update({ scheduledCheckOutAt: Timestamp.fromMillis(Date.now() - 1000) });
    const member = client('member');
    await expect(setDoc(doc(member, 'redemptionRecords/checkin_member_request'), {
      userId: 'member', visitSessionId: 'checkin_member_request', redemptions: [{ userId: 'member', redeemedBy: 'member', quantity: 1,
        status: 'pending', redeemedAt: new Date() }],
    })).rejects.toMatchObject({ code: 'permission-denied' });
  }, 15000);
  it('keeps disabled lounges on the existing client creation path', async () => {
    await expect(setDoc(doc(client('member'), 'visitSessions/legacy'), {
      userId: 'member', storeId: 'legacy', status: 'pending', checkInAt: new Date(),
    })).resolves.toBeUndefined();
  }, 15000);
});
