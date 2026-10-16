// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
const mocks = vi.hoisted(() => ({ load: vi.fn(), health: vi.fn(), assert: vi.fn(), send: vi.fn(), attach: vi.fn() }));
vi.mock('../functions/_shared/whatsapp', () => ({ loadWhatsApp: mocks.load, assertWhatsAppBinding: mocks.assert, submitWhapi: mocks.send }));
vi.mock('../functions/_shared/whatsappConnection', () => ({ readWhapiHealth: mocks.health }));
vi.mock('../functions/_shared/whapiReceipts', () => ({ attachSubmission: mocks.attach }));
import { buildLoungeReportSnapshot, sendLoungeReport } from '../functions/_shared/loungeDailyReport';
let records: Record<string, any>;
const ref = (path: string): any => ({ id: path.split('/')[1], path, get: async () => ({ data: () => records[path] }),
  update: async (data: any) => {
    for (const [key, value] of Object.entries(data)) {
      const [parent, child] = key.split('.');
      if (child) records[path][parent][child] = value; else records[path][parent] = value;
    }
  },
});
const db = { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }), runTransaction: async (callback: any) => callback({
  get: async (r: any) => r.get(), update: (r: any, data: any) => Object.assign(records[r.path], data),
  create: (r: any, data: any) => { if (records[r.path]) throw new Error('duplicate'); records[r.path] = data; },
}) } as unknown as Firestore;
const report = () => ref('_loungeDailyReports/report');
describe('daily report verified Whapi self-delivery', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv('LOUNGE_DAILY_REPORTS_ENABLED', 'true');
    records = {
      '_loungeDailyReports/report': { storeId: 'lounge', text: 'English report', delivery: { status: 'not-sent' } },
      'stores/lounge': { operations: { dailyReportEnabled: true, whapiChannelId: 'channel' } },
      '_whatsappConfig/settings': { whapiUserId: '60123456789', config: { enabled: true } },
    };
    mocks.load.mockResolvedValue({ token: 'server-only-token', verified: true, binding: 'binding', config: { enabled: true, whapi: { channelId: 'channel' } } });
    mocks.health.mockResolvedValue({ status: 'connected', account: '60123456789', channelId: 'channel' });
    mocks.send.mockResolvedValue({ status: 'accepted', messageId: 'message' });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('sends only to the freshly verified user.id, once', async () => {
    await sendLoungeReport(db, report()); await sendLoungeReport(db, report());
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith('server-only-token', '60123456789', 'English report');
    expect(records['_loungeDailyReports/report'].delivery.status).toBe('accepted');
    expect(mocks.attach).toHaveBeenCalledOnce();
  });
  it('does not send when either switch is disabled', async () => {
    vi.stubEnv('LOUNGE_DAILY_REPORTS_ENABLED', 'false'); await sendLoungeReport(db, report());
    vi.stubEnv('LOUNGE_DAILY_REPORTS_ENABLED', 'true'); records['stores/lounge'].operations.dailyReportEnabled = false;
    await sendLoungeReport(db, report()); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('rejects replaced channels or mismatched account identities', async () => {
    records['stores/lounge'].operations.whapiChannelId = 'replaced';
    await expect(sendLoungeReport(db, report())).rejects.toThrow('channel-unverified');
    records['stores/lounge'].operations.whapiChannelId = 'channel'; mocks.health.mockResolvedValue({ status: 'connected', account: 'other', channelId: 'channel' });
    await expect(sendLoungeReport(db, report())).rejects.toThrow('channel-unverified');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('keeps timeout results unknown and never blindly resends', async () => {
    mocks.send.mockRejectedValue(new Error('timeout'));
    await sendLoungeReport(db, report()); await sendLoungeReport(db, report());
    expect(records['_loungeDailyReports/report'].delivery.status).toBe('unknown');
    expect(mocks.send).toHaveBeenCalledOnce();
  });
});

describe('read-only report snapshot rendering', () => {
  it('marks tests explicitly and never writes reports, balances, sessions or inventory', async () => {
    const at = new Date('2026-10-15T12:00:00+08:00');
    const fixture: Record<string, any[]> = {
      visitSessions: [{ id: 'visit', status: 'completed', checkInAt: at, pointsDeducted: 20 },
        { id: 'pending', status: 'pending', checkInAt: at }],
      redemptionRecords: [{ id: 'pending', redemptions: [{ status: 'pending', quantity: 2 }] }],
      pointsRecords: [{ id: 'ledger', userId: 'user', type: 'spend', amount: 20, balanceBefore: 30, balance: 10, createdAt: at, storeId: 'lounge' }],
      users: [{ id: 'user', membership: { points: 10 } }],
    };
    const before = JSON.stringify(fixture);
    const collection = (name: string): any => {
      const query = { doc: () => ({ get: async () => ({ data: () => ({ name: 'Test Lounge' }) }) }),
        where: () => query, orderBy: () => query, limit: () => query,
        get: async () => ({ size: (fixture[name] || []).length, docs: (fixture[name] || []).map(row => ({ id: row.id, data: () => row })) }),
      };
      return query;
    };
    const readOnlyDb = { collection } as unknown as Firestore;
    const report = await buildLoungeReportSnapshot(readOnlyDb, 'lounge', '2026-10-15', {}, 0, true);
    expect(report.text).toContain('[TEST] Daily Lounge Report');
    expect(report.text).toContain('Settlement: NOT EXECUTED - TEST ONLY');
    expect(report.text).toContain('Visit fees (today\'s arrivals): 20.00 points');
    expect(report.text).toContain('Pending cigar selections: 2');
    expect(report.text).not.toContain('Closing debt after settlement');
    expect(JSON.stringify(fixture)).toBe(before);
    const formal = await buildLoungeReportSnapshot(readOnlyDb, 'lounge', '2026-10-15', { status: 'completed', remaining: 0 }, 1);
    expect(formal.text).toContain('Settlement: COMPLETE'); expect(formal.text).not.toContain('[TEST]');
  });
});
