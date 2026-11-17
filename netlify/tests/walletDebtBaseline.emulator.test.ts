// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeApp as initializeClient, deleteApp as deleteClient } from 'firebase/app';
import { connectFirestoreEmulator, doc, getFirestore as clientFirestore, setDoc, terminate } from 'firebase/firestore';
import { saveWalletDebtBaseline } from '../functions/_shared/walletDebtBaseline';
import { buildLoungeReportSnapshot } from '../functions/_shared/loungeDailyReport';

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8089';
const projectId = 'demo-wallet-debt';
describe.runIf(enabled)('wallet baselines and snapshot reads (isolated Firestore emulator)', () => {
  const app = enabled ? initializeApp({ projectId }, 'wallet-debt-emulator') : undefined;
  const db = app ? getFirestore(app) : undefined;
  const clients: ReturnType<typeof initializeClient>[] = [];
  const cutoff = Date.parse('2026-10-14T15:00:00Z');
  beforeEach(async () => {
    const response = await fetch(`http://127.0.0.1:8089/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to reset isolated emulator');
    await Promise.all([
      db!.doc('users/reviewer').set({ role: 'developer', status: 'active' }),
      db!.doc('users/member').set({ displayName: 'Historical member', membership: { points: 156 } }),
      db!.doc('stores/lounge').set({ name: 'Lounge' }),
      db!.doc('visitSessions/visit').set({ userId: 'member', storeId: 'lounge', checkInAt: Timestamp.fromMillis(cutoff), status: 'completed' }),
      db!.doc('pointsRecords/history').set({ userId: 'member', type: 'earn', amount: 156, createdAt: Timestamp.fromMillis(cutoff - 1000),
        migration: { source: 'legacy_workbook', balanceNotApplied: true }, description: 'Historical reload import' }),
    ]);
  });
  afterAll(async () => {
    for (const client of clients) { await terminate(clientFirestore(client)); await deleteClient(client); }
    if (app) await deleteApp(app);
  });
  it('serializes concurrent approvals and generates a consistent read-only snapshot with history retained', async () => {
    const input = { storeId: 'lounge', userId: 'member', at: cutoff, balance: 156, expectedVersion: 0,
      evidenceReference: 'test-verified-original-archive', note: 'Independent archival balance and timestamp verified', confirm: true };
    const results = await Promise.allSettled([saveWalletDebtBaseline(db!, 'reviewer', input), saveWalletDebtBaseline(db!, 'reviewer', input)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('baseline-conflict');
    const report = await buildLoungeReportSnapshot(db!, 'lounge', '2026-10-15', {}, 0, true);
    expect(report.debtDetails.consistency).toBe('transaction');
    expect(report.debtDetails.customers[0]).toMatchObject({ reliable: true, walletBalance: 156, expectedBalance: 156, entryCounts: { historical: 1, included: 0 } });
    expect((await db!.doc('users/member').get()).data()?.membership.points).toBe(156);
    expect((await db!.collection('pointsRecords').get()).size).toBe(1);
    expect((await db!.collection('_walletDebtBaselineVersions').get()).size).toBe(1);
    expect((await db!.collection('audit_logs').get()).size).toBe(1);
  }, 30000);
  it('denies direct browser writes to baselines and immutable versions, including developer clients', async () => {
    const client = initializeClient({ projectId, apiKey: 'emulator-only' }, `wallet-client-${clients.length}`); clients.push(client);
    const browserDb = clientFirestore(client);
    connectFirestoreEmulator(browserDb, '127.0.0.1', 8089, { mockUserToken: { sub: 'reviewer' } });
    for (const path of ['_walletDebtBaselines/member', '_walletDebtBaselineVersions/member_v1']) {
      await expect(setDoc(doc(browserDb, path), { balance: 999 })).rejects.toMatchObject({ code: 'permission-denied' });
    }
  });
});
