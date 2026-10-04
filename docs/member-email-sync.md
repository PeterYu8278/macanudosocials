# Member Email Synchronization

## Behavior

- Unchanged normalized emails do not trigger identity verification or an Auth update.
- Members reauthenticate with their current password or linked Google account, then receive an application-managed confirmation at the new address. The link opens Profile; the member explicitly confirms after identity verification. Auth and Firestore keep the old email until this step completes.
- New confirmations are revocable, single-use and expire after one hour. Resending invalidates the previous link. Cancel remains available after sending, until confirmation starts updating Auth.
- The default administrator action stores a request. It does not send mail automatically: the member opens Profile and sends the confirmation after reauthentication.
- Explicit administrator correction updates the target Auth account immediately, marks the new email unverified, and synchronizes Firestore. The member can then verify the new address from Profile.
- Phone verification confirms the operator's identity, not ownership of the new phone number. This flow does not send an SMS.

## Deployment

1. Deploy `update-member-email`, the updated `update-member-phone`, and the Firestore rules before publishing the frontend. Deploying only the frontend will break protected identity synchronization.
2. Configure `FIREBASE_SERVICE_ACCOUNT` for the same Firebase project used by the frontend, as with the existing functions. Never expose it through a Vite variable.
3. Set backend-only `RESEND_API_KEY`, `MEMBER_EMAIL_FROM` (a verified Resend sender), and `MEMBER_EMAIL_ORIGIN` (the exact HTTPS frontend origin, without a path). Configure the origin separately for each deployment environment. No mail is sent if this configuration is missing. Sender configuration: https://resend.com/docs/api-reference/emails/send-email
4. Ensure frontend origins remain authorized in Firebase Authentication for Google reauthentication. Keep Firebase's hosted action handler enabled for verification of an administrator-corrected email and older links; those still use `/profile?emailSync=1`.
5. Smoke-test mailbox delivery and confirmation using a dedicated test member. Sign in to the existing account in the browser opening the link; reopen the mail link after login if the route guard redirected it. Proofs are kept in memory only and cleared from the address bar; refreshing the page requires reopening the link. Tests in this repository do not send production emails or modify production Auth accounts.

## Recovery And Security

- `authUid` is recorded before any Auth email mutation, so legacy document IDs can still resolve to the same account after changing the login email.
- Auth is authoritative during synchronization. The client cannot choose an Auth UID or supply the synchronized email.
- Mutations require recent password/Google authentication. Administrator corrections require a higher role than the target member; self-service synchronization does not grant administrator rights.
- Firestore protects `authUid`, `emailAuth`, and `emailChange` against client writes. Backend audit records live in `_memberEmailChanges`; expiring leases in `_memberEmailLocks` serialize backend operations for one Auth UID.
- An Auth change followed by a failed Firestore write leaves recoverable `sync-pending` state. Retry synchronization from Profile or retry the same administrator correction; never create a replacement Auth account.
- New requests with `proofVersion: 1` use random 256-bit tokens. Only their SHA-256 hashes are stored in the backend-only `_memberEmailProofs` collection. Confirmation checks the current request ID, account UID, target email, expiration, recent identity verification and proof hash before updating Auth. A lease serializes confirmation and cancellation. Merely visiting the link does not confirm the change.
- Send attempts are limited to one per minute per Auth UID, including after cancellation. `_memberEmailSendLimits` is backend-only. Delivery failure may leave a cancellable request; the user can resend after the cooldown.
- Already-issued Firebase links cannot be revoked by this new token flow. Legacy awaiting requests remain protected against cancellation, replacement and resending through the new flow. Compatibility `prepare` requests from old clients remain explicitly legacy; do not relabel them as revocable.
- If confirmation updates Auth but the profile write fails, synchronization consumes the pending proof when it completes. If Auth never changed, reopening the still-valid link permits a verified retry; expired proofs in this intermediate state need administrator recovery.
- An email change may invalidate the old session. Sign in again using the new email if synchronization requests reauthentication.
- This feature still needs Firestore for pending state, permissions, auditing and profile writes. It does not bypass Firestore quota exhaustion.

## Local Verification

Run the member email/phone backend and service tests, the reauthentication hook tests, and `src/views/frontend/Profile/emailChange.test.tsx` with Vitest. The rules tests additionally require a local Firestore emulator, project `demo-member-email`, and `FIRESTORE_RULES_TEST_HOST=127.0.0.1:8089`; they reject non-local hosts.
