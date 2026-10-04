# Member Email Synchronization

## Behavior

- Unchanged normalized emails do not trigger identity verification or an Auth update.
- Members reauthenticate with their current password or linked Google account, then receive a Firebase `verifyBeforeUpdateEmail` confirmation at the new address. The old login email remains in the profile until Auth confirms the change.
- The default administrator action stores a request. It does not send mail automatically: the member opens Profile and sends the confirmation after reauthentication.
- Explicit administrator correction updates the target Auth account immediately, marks the new email unverified, and synchronizes Firestore. The member can then verify the new address from Profile.
- Phone verification confirms the operator's identity, not ownership of the new phone number. This flow does not send an SMS.

## Deployment

1. Deploy `update-member-email`, the updated `update-member-phone`, and the Firestore rules before publishing the frontend. Deploying only the frontend will break protected identity synchronization.
2. Configure `FIREBASE_SERVICE_ACCOUNT` for the same Firebase project used by the frontend, as with the existing functions. Never expose it through a Vite variable.
3. Ensure every frontend origin used for email confirmation is in Firebase Authentication's authorized domains. Keep Firebase's hosted email action handler enabled in the email templates; the continuation URL is `/profile?emailSync=1` on the current origin.
4. Smoke-test mailbox delivery and confirmation using a dedicated test member. Tests in this repository do not send production emails or modify production Auth accounts.

## Recovery And Security

- `authUid` is recorded before any Auth email mutation, so legacy document IDs can still resolve to the same account after changing the login email.
- Auth is authoritative during synchronization. The client cannot choose an Auth UID or supply the synchronized email.
- Mutations require recent password/Google authentication. Administrator corrections require a higher role than the target member; self-service synchronization does not grant administrator rights.
- Firestore protects `authUid`, `emailAuth`, and `emailChange` against client writes. Backend audit records live in `_memberEmailChanges`; expiring leases in `_memberEmailLocks` serialize backend operations for one Auth UID.
- An Auth change followed by a failed Firestore write leaves recoverable `sync-pending` state. Retry synchronization from Profile or retry the same administrator correction; never create a replacement Auth account.
- A request can be cancelled before a Firebase confirmation is issued. Issued confirmation links cannot be revoked simply by clearing Firestore state, so cancellation is not offered after that point.
- An email change may invalidate the old session. Sign in again using the new email if synchronization requests reauthentication.
- This feature still needs Firestore for pending state, permissions, auditing and profile writes. It does not bypass Firestore quota exhaustion.

## Local Verification

Run the member email/phone backend and service tests, the reauthentication hook tests, and `src/views/frontend/Profile/emailChange.test.tsx` with Vitest. The rules tests additionally require a local Firestore emulator, project `demo-member-email`, and `FIRESTORE_RULES_TEST_HOST=127.0.0.1:8089`; they reject non-local hosts.
