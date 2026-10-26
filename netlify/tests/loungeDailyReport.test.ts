// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
const mocks = vi.hoisted(() => ({ load: vi.fn(), health: vi.fn(), assert: vi.fn(), send: vi.fn(), attach: vi.fn(),
  meow: vi.fn(), gateway: vi.fn(), meowAssert: vi.fn(), meowSend: vi.fn() }));
vi.mock('../functions/_shared/whatsmeow', async importOriginal => ({ ...await importOriginal<typeof import('../functions/_shared/whatsmeow')>(),
  loadMeow: mocks.meow, gatewayRequest: mocks.gateway, assertMeowBinding: mocks.meowAssert, submitMeow: mocks.meowSend }));
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
    mocks.attach.mockImplementation(async (_db, _id, _channel, submitted) => submitted.status);
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
  const enableMeow = () => {
    records['_whatsappConfig/settings'].config.defaultProvider = 'whatsmeow';
    records['stores/lounge'].operations.reportDelivery = { provider: 'whatsmeow', channelId: 'whatsmeow:pilot:session', recipient: '+60199887766' };
    mocks.meow.mockResolvedValue({ gatewayId: 'pilot', sessionId: 'session', account: '+60123456789', version: 'v1', baseUrl: 'https://gateway.example.com', token: 'private' });
    mocks.gateway.mockResolvedValue({ status: 'connected', sessionId: 'session', account: '+60123456789' });
    mocks.meowSend.mockResolvedValue({ status: 'accepted', messageId: 'meow-message' });
  };
  it('sends Whatsmeow reports to the separately configured recipient once with a gateway-safe task ID', async () => {
    enableMeow();
    await sendLoungeReport(db, report()); await sendLoungeReport(db, report());
    const delivery = records['_loungeDailyReports/report'].delivery;
    expect(delivery).toMatchObject({ provider: 'whatsmeow', recipient: '+60199887766', channelId: 'whatsmeow:pilot:session', status: 'accepted' });
    expect(delivery.taskId).toMatch(/^lounge-[a-f0-9]{64}$/);
    expect(mocks.meowSend).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ version: 'v1' }), delivery.taskId,
      '+60199887766', 'English report', expect.any(Number));
    expect(records[`_whatsappTasks/${delivery.taskId}`].provider).toBe('whatsmeow');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('allows explicit Whapi recipients without confusing them with the sending account', async () => {
    records['stores/lounge'].operations.reportDelivery = { provider: 'whapi', channelId: 'channel', recipient: '+60199887766' };
    await sendLoungeReport(db, report());
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith('server-only-token', '+60199887766', 'English report');
  });
  it('does not silently migrate legacy self-delivery when the global provider changes', async () => {
    records['_whatsappConfig/settings'].config.defaultProvider = 'whatsmeow';
    await expect(sendLoungeReport(db, report())).rejects.toThrow('channel-unverified');
    expect(mocks.meowSend).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('rejects changed Whatsmeow session identity before claiming', async () => {
    enableMeow(); mocks.gateway.mockResolvedValue({ status: 'connected', sessionId: 'replacement', account: '+60123456789' });
    await expect(sendLoungeReport(db, report())).rejects.toThrow('channel-unverified');
    expect(records['_loungeDailyReports/report'].delivery.status).toBe('not-sent');
  });
  it('fences recipient changes between health check and claim', async () => {
    enableMeow(); mocks.gateway.mockImplementation(async () => {
      records['stores/lounge'].operations.reportDelivery.recipient = '+60111112222';
      return { status: 'connected', sessionId: 'session', account: '+60123456789' };
    });
    await expect(sendLoungeReport(db, report())).rejects.toThrow('channel-unverified');
    expect(mocks.meowSend).not.toHaveBeenCalled();
  });
  it('retains unknown on Whatsmeow timeout with no Whapi fallback', async () => {
    enableMeow(); mocks.meowSend.mockRejectedValue(new Error('timeout'));
    await sendLoungeReport(db, report()); await sendLoungeReport(db, report());
    expect(records['_loungeDailyReports/report'].delivery.status).toBe('unknown');
    expect(mocks.meowSend).toHaveBeenCalledOnce(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('rejects a revoked gateway binding before creating a sending task', async () => {
    enableMeow(); mocks.meowAssert.mockRejectedValue(new Error('connection-changed'));
    await expect(sendLoungeReport(db, report())).rejects.toThrow('connection-changed');
    expect(records['_loungeDailyReports/report'].delivery.status).toBe('not-sent');
    expect(mocks.meowSend).not.toHaveBeenCalled();
  });
  it('keeps a receipt that arrived before the submission response', async () => {
    enableMeow(); mocks.attach.mockResolvedValue('read');
    await sendLoungeReport(db, report());
    expect(records['_loungeDailyReports/report'].delivery.status).toBe('read');
  });
});

describe('read-only report snapshot rendering', () => {
  it('marks tests explicitly and never writes reports, balances, sessions or inventory', async () => {
    const at = new Date('2026-10-15T12:00:00+08:00');
    const fixture: Record<string, any[]> = {
      visitSessions: [{ id: 'visit', userId: 'user', status: 'completed', checkInAt: at, pointsDeducted: 20, durationHours: 1.25 },
        { id: 'repeat', userId: 'user', status: 'completed', checkInAt: at, pointsDeducted: 10, durationHours: 0.5 },
        { id: 'pending', userId: 'other', status: 'pending', checkInAt: at, durationHours: 9 },
        { id: 'carryover', userId: 'older', status: 'pending', checkInAt: new Date('2026-10-14T12:00:00+08:00') }],
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
    expect(report.text).toContain('Customers: 2');
    expect(report.text).toContain('Completed visits: 2');
    expect(report.text).toContain('Incompleted visits (including carryovers): 2');
    expect(report.text).toContain('Visit fees: 30.00 pts / 1.75 hrs');
    expect(report.text).not.toContain('Check-ins:');
    expect(report.text).not.toContain('Unresolved stock settlements:');
    expect(report.text).not.toContain('Unresolved visits');
    expect(report.text).toContain('Pending cigar selections: 2');
    expect(report.text).not.toContain('Closing debt after settlement');
    expect(report.text).toContain('Outstanding lounge debt (verified): 0.00 pts');
    expect(report.text).not.toContain('Historical opening debt:');
    expect(report.text).toContain('Snapshot (MYT):');
    expect(report.debtDetails.historical).toBe(true);
    expect(report.debtDetails.customers).toEqual([]);
    expect(JSON.stringify(fixture)).toBe(before);
    const formal = await buildLoungeReportSnapshot(readOnlyDb, 'lounge', '2026-10-15', { status: 'completed', remaining: 0 }, 1);
    expect(formal.text).toContain('Settlement: COMPLETE'); expect(formal.text).not.toContain('[TEST]');
    expect(formal.text).toContain('Customers: 2');
    expect(formal.text).toContain('Incompleted visits (including carryovers): 0');
    expect(formal.text).toContain('Visit fees: 30.00 pts / 1.75 hrs');
    expect(formal.text).not.toContain('Unresolved stock settlements:');
  });
  it('freezes customer debt evidence and separates unreliable wallets without disclosing other lounge descriptions', async () => {
    vi.stubEnv('URL', 'https://example.com');
    const at = new Date('2026-10-15T12:00:00+08:00');
    const fixture: Record<string, any[]> = {
      visitSessions: [{ id: 'visit', userId: 'user', status: 'completed', checkInAt: at, pointsDeducted: 20, durationHours: 1 }],
      pointsRecords: [
        { id: 'fee', userId: 'user', type: 'spend', amount: 20, balanceBefore: 0, balance: -20, createdAt: at, storeId: 'lounge', relatedId: 'visit', source: 'visit' },
        { id: 'repayment', userId: 'user', type: 'earn', amount: 5, balanceBefore: -20, balance: -15, createdAt: new Date(at.getTime() + 1000), storeId: 'other', description: 'private other lounge', relatedId: 'other-record' },
        { id: 'gap', userId: 'review', type: 'spend', amount: 10, balance: -10, createdAt: at, storeId: 'lounge' },
      ],
      users: [{ id: 'user', displayName: 'Customer', memberId: 'MEM001', membership: { points: -15 } },
        { id: 'review', displayName: 'Review customer', membership: { points: -50 } }],
    };
    const collection = (name: string): any => {
      const q = { doc: () => ({ get: async () => ({ data: () => ({ name: 'Lounge' }) }) }), where: () => q, orderBy: () => q, limit: () => q,
        get: async () => ({ size: (fixture[name] || []).length, docs: (fixture[name] || []).map(row => ({ id: row.id, data: () => row })) }) };
      return q;
    };
    try {
      const report = await buildLoungeReportSnapshot({ collection } as unknown as Firestore, 'lounge', '2026-10-15', {}, 0, true, 'saved-report');
      expect(report.text).toContain('Outstanding lounge debt (verified): 15.00 pts');
      expect(report.text).toContain('Data status: INCOMPLETE');
      expect(report.text).toContain('Customers requiring review at this lounge: 1');
      expect(report.text).toContain('loungeId=lounge&reportId=saved-report&reportKind=test');
      const [customer, review] = report.debtDetails.customers;
      expect(customer).toMatchObject({ name: 'Customer', memberId: 'MEM001', opening: 0, added: 20, repaid: 5, outstanding: 15, reliable: true });
      expect(customer.entries.find(e => e.id === 'fee')).toMatchObject({ relatedId: 'visit', amount: -20 });
      expect(customer.entries.find(e => e.id === 'repayment')).toMatchObject({ description: '', relatedId: '', local: false });
      expect(review).toMatchObject({ reliable: false, outstanding: null, reasons: ['wallet-mismatch'] });
      fixture.users[0].membership.points = 100;
      expect(customer.walletBalance).toBe(-15);
    } finally { vi.unstubAllEnvs(); }
  });
});
