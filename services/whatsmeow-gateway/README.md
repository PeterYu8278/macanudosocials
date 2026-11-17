# Whatsmeow gateway

Persistent Go service, separate from Netlify. Uses the official whatsmeow SQL
device store, PostgreSQL, an encrypted durable text outbox, and HMAC callbacks.
This is an unofficial WhatsApp Web integration, not Meta's supported Business API.
Use an approved pilot number and obtain recipient consent before enabling business sends.

## Deployment

1. Provision an always-on host with Docker and an HTTPS reverse proxy. Do not use
   a sleeping/free service or Netlify Functions for this process.
2. Configure the variables described in `.env.example` in the host secret manager.
   API token and callback secret must each contain at least 32 random characters.
   Generate a separate 32-byte base64 payload encryption key. Do not reuse keys.
3. Run `docker compose --env-file /secure/path/gateway.env up -d --build` from this
   directory. The API binds to loopback port 8080; terminate TLS in the reverse proxy.
   The database is private to Compose and is never published to the host network.
   Use an alphanumeric database password, or URL-encode it in a custom DATABASE_URL.
4. Set Netlify Functions variables once:
   `WHATSMEOW_GATEWAYS={"pilot":"https://gateway.example.com"}` and
   `WHATSMEOW_CALLBACK_SECRETS={"pilot":"the-independent-callback-secret"}`.
   Keep the existing `WHATSAPP_CREDENTIAL_ENCRYPTION_KEY` and Firebase Admin credentials.
5. Redeploy Functions. In Communications / WhatsApp, select the registered gateway,
   enter its API token, verify the candidate, open the connection, and request QR.
   Scan with WhatsApp / Linked devices. Enter the full connected E.164 number and
   explicitly activate. Closing the dialog does not log out the device.
6. Keep business sending paused during pairing. Add the pilot recipient to Test
   phones, save, and use Send test. Check receipt progress before enabling any
   business rules. Never test password recovery with another person's account.

Existing Whapi configuration remains available. To roll back, select Whapi and save
only after checking its existing verification. No automatic provider fallback occurs.
Messages already claimed retain their original provider. Stopping new business sends
does not recall messages already accepted into a gateway queue (maximum five minutes;
password reset and form confirmation queues expire after one minute).

## Lounge Daily Reports

In each lounge's Operations settings, save an explicit report provider, channel
ID, and E.164 recipient (for example `+60123456789`). Whatsmeow channel IDs are
`whatsmeow:<GATEWAY_ID>:<GATEWAY_SESSION_ID>` and must match the activated
gateway. The global WhatsApp provider must match the lounge's report provider;
there is no automatic cross-provider fallback. The recipient is independent of
the sending account. Legacy lounges without an explicit route retain Whapi
self-delivery and do not automatically switch to Whatsmeow.

Save settings before generating an independent test report. Previews bind to the
provider, channel, credentials and recipient; changing any of these requires a
new preview. Previewing does not send, and sending a test still requires explicit
confirmation. Formal reports require both the lounge report switch and the
server-side `LOUNGE_DAILY_REPORTS_ENABLED=true` switch. Test reports remain
available independently of scheduled closing. Both report texts remain English.

Report tasks claim once before submission. Unknown submissions require manual
investigation, not automatic resending. Whatsmeow queues expire within five
minutes (or the test preview's remaining validity, if shorter). Already accepted
tasks retain their original channel after a provider change. Receipt progress is
read from the original task; a delayed receipt is never reassigned to a new
provider or session. Deploy the updated Netlify Functions and web UI together;
these changes do not activate a production gateway or send a test automatically.

## Switching Numbers

Each gateway deployment owns one device database. Stage a second gateway with its
own database and unique session ID to change numbers without destroying the old
session. Register the additional origin and callback secret server-side once.
After registration, switching among gateways uses the admin panel without editing
WHAPI_API_TOKEN or redeploying. API tokens are stored encrypted in private Firestore.
Never reuse a session ID after resetting or replacing its database. The gateway
refuses to start when the stored database identity differs from the configured one.
There is deliberately no browser logout/delete-device endpoint.

## Delivery And Recovery

- Request ID is an idempotency key; changing the payload for an existing ID conflicts.
- Device account and session must match every submission. Arbitrary frontend URLs
  are not accepted; the backend uses only registered HTTPS origins, without redirects.
- Provider message IDs are persisted before sending. Interrupted or ambiguous sends
  become unknown and are not automatically resent, including after process restart.
- Delivery/read receipts can advance an unknown result. Callbacks are signed over
  timestamp, event ID, and raw body, with a five-minute acceptance window. Consumers
  are idempotent; inbound messages additionally have a persistent processing lease.
- Direct text registration uses the existing account-creation flow, with CONFIRM /
  CANCEL commands and the existing feature switch and registration allowlist. Group,
  broadcast, outgoing, old, or unresolved LID senders are ignored.
- There is no automatic media, group messaging, or interactive-button translation.
- A PostgreSQL advisory lock prevents two gateway owners sharing one database.
  Reconnection stops after ten consecutive failures; investigate and reconnect in
  the panel. Do not deploy multiple independent databases for the same account.

## Operations And Validation

Encrypt the database volume and backups: WhatsApp device private keys live in the
official SQL store. Application payload encryption does not encrypt those SQL keys.
Back up the database and encryption keys separately; test restoring to an isolated
host with the original host stopped. Never log tokens, QR strings, message bodies,
password-reset URLs, or registration passwords. Retain gateway outbox metadata only
for the audit period required by your business. Successful callbacks are deleted;
undelivered inbound message bodies expire after two minutes. Failed callback rows
otherwise remain for operator investigation and are retried with capped backoff.

Run `go test ./...`, `go vet ./...`, and `go build ./...`. Run the Netlify WhatsApp
tests and the root web build. Before production approval, exercise a real PostgreSQL
restart, process termination during send, QR expiry, phone unlink, stale callbacks,
and a full pilot send/read/registration/reset cycle. Unit tests do not replace these
live acceptance checks. No production number is automatically activated by deployment.
