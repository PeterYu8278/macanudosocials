import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { GLOBAL_COLLECTIONS as C } from '../../../src/config/globalCollections';
import type { LoungeOperations } from '../../../src/utils/loungeOperations';
import { loungeError } from './loungeVisits';
import { assertWhatsAppBinding, loadWhatsApp, submitWhapi } from './whatsapp';
import { readWhapiHealth } from './whatsappConnection';
import { assertMeowBinding, gatewayRequest, loadMeow, submitMeow, validGatewayStatus } from './whatsmeow';

type Operations = Partial<LoungeOperations> | undefined;
const routeKey = (operations: Operations) => JSON.stringify(operations?.reportDelivery
  ? [operations.reportDelivery.provider, operations.reportDelivery.channelId, operations.reportDelivery.recipient]
  : ['legacy-whapi', operations?.whapiChannelId || '']);

export const loungeReportTaskId = (reportId: string, provider: string) => provider === 'whatsmeow'
  ? `lounge-${createHash('sha256').update(reportId).digest('hex')}` : `lounge-${reportId}`;

// Resolve once, then fence the saved route and credentials inside the claim transaction.
// Legacy lounges retain Whapi self-delivery; they never silently adopt Whatsmeow.
export async function loadLoungeReportTransport(db: Firestore, operations: Operations, allowDefaultChannel = false) {
  const explicit = operations?.reportDelivery;
  const provider = explicit?.provider || 'whapi';
  if (!['whapi', 'whatsmeow'].includes(provider)) throw loungeError('channel-unverified');
  if (explicit && (!explicit.channelId || !/^\+[1-9]\d{6,14}$/.test(explicit.recipient))) throw loungeError('channel-unverified');
  const settings = (await db.collection(C.WHATSAPP_CONFIG).doc('settings').get()).data();
  const selected = settings?.config?.defaultProvider || 'whapi';
  if (selected !== provider || settings?.config?.enabled !== true) throw loungeError('channel-unverified');
  const key = routeKey(operations);
  const meow = provider === 'whatsmeow' ? await loadMeow(db) : null;
  const whapi = meow ? null : await loadWhatsApp(db);
  let channelId: string, account: string, binding: string;
  if (meow) {
    channelId = `whatsmeow:${meow.gatewayId}:${meow.sessionId}`;
    if (explicit?.channelId !== channelId) throw loungeError('channel-unverified');
    const health = validGatewayStatus(await gatewayRequest(meow.baseUrl, meow.token, '/v1/status'));
    if (health.status !== 'connected' || health.sessionId !== meow.sessionId || health.account !== meow.account) throw loungeError('channel-unverified');
    account = meow.account;
    binding = `whatsmeow:${meow.version}`;
  } else {
    channelId = explicit?.channelId || operations?.whapiChannelId || (allowDefaultChannel ? whapi!.config.whapi.channelId : '');
    if (!whapi!.config.enabled || !whapi!.verified || !whapi!.token || !channelId || channelId !== whapi!.config.whapi.channelId) throw loungeError('channel-unverified');
    const health = await readWhapiHealth(whapi!.token, channelId);
    if (health.status !== 'connected' || health.channelId !== channelId || !/^\d{6,20}$/.test(health.account)
      || health.account !== settings?.whapiUserId) throw loungeError('channel-unverified');
    account = health.account;
    binding = whapi!.binding || '';
  }
  const recipient = explicit?.recipient || account;
  return {
    provider, channelId, recipient, binding, routeKey: key,
    async assert(tx: any, freshOperations: Operations) {
      const freshSettings = (await tx.get(db.collection(C.WHATSAPP_CONFIG).doc('settings'))).data();
      if (routeKey(freshOperations) !== key || freshSettings?.config?.enabled !== true
        || (freshSettings.config.defaultProvider || 'whapi') !== provider) throw loungeError('channel-unverified');
      if (meow) await assertMeowBinding(db, tx, meow);
      else {
        if (freshSettings.whapiUserId !== account || freshSettings.config.whapi?.channelId && freshSettings.config.whapi.channelId !== channelId) throw loungeError('channel-unverified');
        await assertWhatsAppBinding(db, tx, whapi!.binding, true);
      }
    },
    submit(taskId: string, text: string, expiresAtMs: number) {
      return meow ? submitMeow(meow, taskId, recipient, text, expiresAtMs) : submitWhapi(whapi!.token, recipient, text);
    },
  };
}
