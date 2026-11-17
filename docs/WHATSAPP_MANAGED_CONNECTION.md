# Managed Whapi Connection

## One-Time Deployment

Set `WHATSAPP_CREDENTIAL_ENCRYPTION_KEY` in Netlify Functions to 32 cryptographically
random bytes encoded as base64. Generate it in a trusted terminal and store a secure
backup. Never commit it, expose it through a `VITE_` variable, or use the Whapi token
as the encryption key. Deploy the updated frontend and Netlify functions together.
Do not rotate this key without re-encrypting/replacing the managed credentials.

The existing `_whatsappConfig` and `_whatsappAttempts` rules already deny client
access, so this feature needs no new Firestore rule or index deployment.

## Migration And Replacement

Only superAdmin/developer can manage connections. In Communications > WhatsApp:

1. Check the effective credential source and saved Channel ID.
2. Migrate Current Credentials creates an encrypted candidate from the effective
   runtime credential (including environment overrides). It does not enable it.
3. Alternatively enter the new Channel ID and Token and save a candidate.
4. Connect the candidate; scan its QR using WhatsApp Linked Devices, or verify an
   already authenticated channel. The account is displayed masked.
5. Confirm Activate Channel. The server rechecks live identity and atomically
   changes credentials, channel, verification and version while preserving business
   enable/feature settings. It never logs out the old channel or sends a test message.
6. Once managed mode is confirmed, `WHAPI_API_TOKEN` is ignored by all send paths.
   It can be removed during later environment maintenance; no deployment is needed
   for subsequent channel/token changes. Invalid managed credentials fail closed.

Candidates last 20 minutes; connection sessions last five minutes. The 20-second
QR display lifetime is a conservative UI refresh interval, not a provider guarantee.
Only PNG data is returned, bounded to 192 KiB, never persisted. Closing a dialog
clears local QR data and cancels the application session, not the provider login.

## Callbacks And Existing Work

Configure each channel's authenticated webhook as in `WHAPI_DELIVERY_WEBHOOK.md`.
The shared server secret and same callback URL work across replacements; the
new channel still needs its webhook settings registered with Whapi. The pairing
dialog works without callbacks, using bounded status checks while visible.
Enable channel/channels and users state events in addition to message/status
events to refresh the managed connection from live health. Event payloads alone
never establish verification. Unknown network errors retain last verification and
display unknown status; explicit disconnection revokes it.

Tasks are bound to the channel/version when claimed. Previously claimed work may
finish on its original token; it is not rerouted. Existing submitting/unknown/
failed tasks are not automatically resent, and reminder deduplication is unchanged.
Retired channel metadata permits delivery receipts but not new registration messages.
In managed mode, unbound legacy tasks are not guessed onto an incoming channel.
Registration sessions started before a channel replacement must restart.

Rollback requires entering and verifying the previous channel/token as a new
candidate. No old plaintext credential is kept after activation. Do not delete
retired-channel metadata while receipts still need reconciliation. No source
redemptions, balances, inventory or membership dates are affected.
