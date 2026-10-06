# Whapi Delivery Webhook

## Server Setup

1. Set `WHAPI_WEBHOOK_SECRET` in Netlify with Functions scope. Use an independent
   cryptographically random secret of at least 32 characters, not the Whapi API token.
   Generate one locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
2. Deploy the functions. Save the correct Whapi Channel ID in WhatsApp management.
3. In the Whapi channel webhook settings, configure:
   - URL: `https://macanudosocials.com/.netlify/functions/whapi-webhook`
   - Mode: `body` (HTTP POST).
   - Events: `statuses.post` and `statuses.put`.
   - Additional header: `Authorization: Bearer <WHAPI_WEBHOOK_SECRET>`.
   - Enable persistent callbacks so temporary failures are retried.
4. Send a new allowlisted test message and open Sending Records. Records refresh
   while the tab is visible. Verify sent, delivered and (when available) read states.

Whapi supports custom webhook headers in its
[OpenAPI specification](https://panel.whapi.cloud/yaml/openapi.yaml).
See the official [status payload examples](https://support.whapi.cloud/help-desk/receiving/webhooks/incoming-webhooks-format/sent-message)
and [webhook settings](https://support.whapi.cloud/help-desk/receiving/webhooks/detailed-webhook-settings).

## Behavior And Limits

- The endpoint fails closed without the secret. It checks authorization and the
  configured channel before processing events, including while business sending is paused.
- Callback authentication configured does not mean Whapi has registered the URL.
  Last status callback reports authenticated status requests received by this endpoint.
- Duplicate and out-of-order callbacks cannot downgrade delivered/read states.
  Early callbacks are retained and reconciled when the send response arrives.
- Only provider IDs, channel IDs, statuses and timestamps are retained; message
  content, recipient identifiers and provider error payloads are discarded.
- Manual sends do not gain delivery confirmations. Older Whapi records can update
  only if they stored a provider message ID and a matching callback is received.
  Previously delivered messages are not automatically backfilled.
- `_whatsappReceipts` is server-only. It contains `expiresAt` for optional Firestore
  TTL cleanup after 30 days. TTL must be enabled separately in the Firebase console;
  writing that field alone does not enable deletion.
- For secret rotation, update both Netlify and the Whapi header, then redeploy.
  There may be a short authentication failure window; persistent retries help.
