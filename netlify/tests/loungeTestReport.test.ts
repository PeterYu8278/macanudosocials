// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), snapshot: vi.fn(), load: vi.fn(), health: vi.fn(), assert: vi.fn(), send: vi.fn(), attach: vi.fn(),
  meow: vi.fn(), gateway: vi.fn(), meowAssert: vi.fn(), meowSend: vi.fn() }));
vi.mock('../functions/_shared/whatsmeow', async importOriginal => ({ ...await importOriginal<typeof import('../functions/_shared/whatsmeow')>(),
  loadMeow: mocks.meow, gatewayRequest: mocks.gateway, assertMeowBinding: mocks.meowAssert, submitMeow: mocks.meowSend }));
vi.mock('../functions/_shared/loungeVisits', () => ({ authorizeLounge: mocks.auth, loungeError: (code: string) => new Error(code) }));
vi.mock('../functions/_shared/loungeDailyReport', () => ({ buildLoungeReportSnapshot: mocks.snapshot }));
vi.mock('../functions/_shared/whatsapp', () => ({ loadWhatsApp: mocks.load, assertWhatsAppBinding: mocks.assert, submitWhapi: mocks.send }));
vi.mock('../functions/_shared/whatsappConnection', () => ({ readWhapiHealth: mocks.health }));
vi.mock('../functions/_shared/whapiReceipts', () => ({ attachSubmission: mocks.attach }));
import { executeLoungeTestReport } from '../functions/_shared/loungeTestReport';

let records: Record<string, any>, writes: string[];
const ref = (path: string): any => ({ id: path.split('/')[1], path,
  get: async () => ({ data: () => records[path] }),
  create: async (data: any) => { if (records[path]) throw new Error('duplicate'); records[path] = data; writes.push(path); },
  update: async (data: any) => { Object.assign(records[path], data); writes.push(path); },
});
const db = { collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }), runTransaction: async (work: any) => {
  const staged: any[] = [];
  const result = await work({
    get: async (r: any) => { if (staged.length) throw new Error('read-after-write'); return r.get(); },
    set: (r: any, data: any) => staged.push([r, data]),
    update: (r: any, data: any) => staged.push([r, { ...records[r.path], ...data }]),
    create: (r: any, data: any) => { if (records[r.path]) throw new Error('duplicate'); staged.push([r, data]); },
  });
  for (const [r, data] of staged) { records[r.path] = data; writes.push(r.path); }
  return result;
} } as unknown as Firestore;
const preview = (date = '2026-10-15') => executeLoungeTestReport(db, 'operator', { action: 'test-report-preview', storeId: 'lounge', businessDate: date });
const send = (draftId: string, extra = {}) => executeLoungeTestReport(db, 'operator', { action: 'test-report-send', storeId: 'lounge', draftId, confirm: true, ...extra });

describe('independent read-only daily report testing', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv('LOUNGE_OPERATIONS_ENABLED', 'false'); vi.stubEnv('LOUNGE_DAILY_REPORTS_ENABLED', 'false');
    records = { 'stores/lounge': { name: 'Lounge' }, '_whatsappConfig/settings': { config: { enabled: true }, whapiUserId: '60123456789' } }; writes = [];
    mocks.load.mockResolvedValue({ token: 'private-token', binding: 'binding', verified: true, config: { enabled: true, whapi: { channelId: 'channel' } } });
    mocks.health.mockResolvedValue({ channelId: 'channel', status: 'connected', account: '60123456789' });
    mocks.snapshot.mockResolvedValue({ text: '[Macanudo Socials]\n[TEST] Daily Lounge Report', debt: {}, createdAt: Timestamp.now() });
    mocks.send.mockResolvedValue({ status: 'accepted', messageId: 'message' });
    mocks.attach.mockImplementation(async (_db, id, _channel, result) => { Object.assign(records[`_whatsappTasks/${id}`], result); return result.status; });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('previews with automatic closing disabled, writes only an isolated test draft and sends nothing', async () => {
    const draft = await preview();
    expect(draft).toMatchObject({ text: expect.stringContaining('[TEST]'), recipient: '***6789' });
    expect(mocks.snapshot).toHaveBeenCalledWith(db, 'lounge', '2026-10-15', {}, 0, true, draft.draftId);
    expect(writes).toEqual([`_loungeTestReports/${draft.draftId}`]);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('sends the frozen server preview once, ignoring client-supplied text and recipient', async () => {
    const draft = await preview();
    expect(await send(draft.draftId!, { text: 'forged', recipient: 'other' })).toMatchObject({ status: 'accepted', messageId: 'message' });
    await send(draft.draftId!);
    records[`_whatsappTasks/lounge-test-${draft.draftId}`].status = 'delivered';
    expect(await executeLoungeTestReport(db, 'operator', { action: 'test-report-status', storeId: 'lounge', draftId: draft.draftId })).toMatchObject({ status: 'delivered' });
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith('private-token', '60123456789', expect.stringContaining('[TEST]'));
    expect(writes.every(path => path.startsWith('_loungeTestReports/') || path.startsWith('_whatsappTasks/'))).toBe(true);
  });
  it('requires explicit confirmation and rejects expired previews', async () => {
    const draft = await preview();
    await expect(send(draft.draftId!, { confirm: false })).rejects.toThrow('test-confirm-required');
    records[`_loungeTestReports/${draft.draftId}`].expiresAt = Timestamp.fromMillis(0);
    await expect(send(draft.draftId!)).rejects.toThrow('test-report-expired');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('rejects foreign drafts, revoked permissions and changed channels or numbers', async () => {
    const draft = await preview();
    await expect(executeLoungeTestReport(db, 'other', { action: 'test-report-send', storeId: 'lounge', draftId: draft.draftId, confirm: true })).rejects.toThrow('test-report-not-found');
    mocks.health.mockResolvedValueOnce({ status: 'connected', channelId: 'channel', account: 'other' });
    await expect(send(draft.draftId!)).rejects.toThrow('channel-unverified');
    mocks.load.mockResolvedValueOnce({ token: 'new', binding: 'changed', verified: true, config: { enabled: true, whapi: { channelId: 'channel' } } });
    await expect(send(draft.draftId!)).rejects.toThrow('channel-unverified');
    mocks.auth.mockRejectedValueOnce(new Error('forbidden'));
    await expect(send(draft.draftId!)).rejects.toThrow('forbidden');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('preserves unknown after a timeout and refreshes without resubmitting', async () => {
    const draft = await preview(); mocks.send.mockRejectedValue(new Error('timeout'));
    expect(await send(draft.draftId!)).toMatchObject({ status: 'unknown' });
    await send(draft.draftId!);
    expect(await executeLoungeTestReport(db, 'operator', { action: 'test-report-status', storeId: 'lounge', draftId: draft.draftId })).toMatchObject({ status: 'unknown' });
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  it('throttles another draft for the same operator and lounge', async () => {
    const first = await preview(), second = await preview();
    await send(first.draftId!);
    await expect(send(second.draftId!)).rejects.toThrow('test-report-rate-limit');
    expect(records[`_loungeTestReports/${second.draftId}`].status).toBe('not-sent');
    expect(mocks.send).toHaveBeenCalledOnce();
  });
  const enableMeow = () => {
    records['_whatsappConfig/settings'].config.defaultProvider = 'whatsmeow';
    records['stores/lounge'].operations = { reportDelivery: { provider: 'whatsmeow', channelId: 'whatsmeow:pilot:session', recipient: '+60199887766' } };
    mocks.meow.mockResolvedValue({ gatewayId: 'pilot', sessionId: 'session', account: '+60123456789', version: 'v1', baseUrl: 'https://gateway.example.com', token: 'private' });
    mocks.gateway.mockResolvedValue({ status: 'connected', sessionId: 'session', account: '+60123456789' });
    mocks.meowSend.mockResolvedValue({ status: 'accepted', messageId: 'meow-message' });
  };
  it('freezes Whatsmeow provider, route and recipient in the test draft and sends once', async () => {
    enableMeow(); const draft = await preview();
    expect(draft).toMatchObject({ provider: 'whatsmeow', channelId: 'whatsmeow:pilot:session', recipient: '***7766' });
    expect(await send(draft.draftId!, { provider: 'whapi', recipient: '+60111112222' })).toMatchObject({ status: 'accepted' });
    await send(draft.draftId!);
    expect(mocks.meowSend).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ version: 'v1' }), `lounge-test-${draft.draftId}`,
      '+60199887766', expect.stringContaining('[TEST]'), expect.any(Number));
    expect(mocks.send).not.toHaveBeenCalled();
    expect(writes.every(path => path.startsWith('_loungeTestReports/') || path.startsWith('_whatsappTasks/'))).toBe(true);
  });
  it('rejects recipient changes after preview', async () => {
    enableMeow(); const draft = await preview();
    records['stores/lounge'].operations.reportDelivery.recipient = '+60111112222';
    await expect(send(draft.draftId!)).rejects.toThrow('channel-unverified');
    expect(mocks.meowSend).not.toHaveBeenCalled();
  });
  it('rejects provider or binding changes after preview without fallback', async () => {
    enableMeow(); const draft = await preview();
    mocks.meow.mockResolvedValueOnce({ gatewayId: 'pilot', sessionId: 'session', account: '+60123456789', version: 'v2', baseUrl: 'https://gateway.example.com', token: 'replacement' });
    await expect(send(draft.draftId!)).rejects.toThrow('channel-unverified');
    records['_whatsappConfig/settings'].config.defaultProvider = 'whapi';
    await expect(send(draft.draftId!)).rejects.toThrow('channel-unverified');
    expect(mocks.meowSend).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('keeps ambiguous Whatsmeow submissions unknown and does not resubmit', async () => {
    enableMeow(); const draft = await preview(); mocks.meowSend.mockRejectedValue(new Error('timeout'));
    expect(await send(draft.draftId!)).toMatchObject({ status: 'unknown' });
    await send(draft.draftId!); expect(mocks.meowSend).toHaveBeenCalledOnce();
  });
  it.each(['2026-02-30', '2099-01-01', '', 'invalid'])('rejects invalid/future dates: %s', async date => {
    await expect(preview(date)).rejects.toThrow('invalid-report-date');
    expect(mocks.send).not.toHaveBeenCalled(); expect(writes).toHaveLength(0);
  });
});
