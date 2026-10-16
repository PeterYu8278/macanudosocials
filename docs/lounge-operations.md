# Lounge closing pilot

This feature is disabled by default. No existing lounge is enabled by deploying
the code alone. All times use Asia/Kuala_Lumpur (UTC+8); closing is fixed at 23:00.
New, unsaved schedules default to daily opening at 10:00. Existing saved hours,
rest days and special dates are preserved; save the schedule explicitly to persist it.

## Deployment order

1. Keep `LOUNGE_OPERATIONS_ENABLED=false` and `LOUNGE_DAILY_REPORTS_ENABLED=false`.
2. Deploy the web app and Netlify functions, then Firestore rules and indexes.
   Wait for the new visitSessions indexes to finish building.
3. Configure an independent random `LOUNGE_JOB_SECRET` of at least 32 characters
   in Netlify Functions scope. Keep it server-only. Netlify's `URL` must point to
   this deployment's trusted HTTPS origin. Do not reuse a WhatsApp token/key.
4. Set `LOUNGE_OPERATIONS_ENABLED=true`. In System Config / lounge management,
   open Lounge Operations. Save weekly opening times and special dates first.
   Enable a pilot lounge only after all its existing visits have finished.
5. Check the Netlify functions list: `close-lounges` must show Scheduled, with
   rounds at 15:00, 15:05 and 15:10 UTC. It dispatches signed requests to
   `lounge-closing-background`; no browser token grants access to that worker.
6. Test a pilot visit and Preview settlement, including a zero/low balance,
   an earlier pending checkout, duplicate retry and a pending cigar selection.
   Check the resulting wallet, ledger, audit and stock movements before rollout.
7. Verify Whapi in Communications, bind its exact active channel ID to the
   lounge and enable the lounge's English report option. Only after verifying
   self-message support for that channel's `user.id`, set
   `LOUNGE_DAILY_REPORTS_ENABLED=true`.

The current provider registry contains one active Whapi credential. Lounge
bindings must match that verified channel; this does not provision concurrent
independent Whapi channels for different lounges. Rebind lounges deliberately
after changing the active provider channel.

## Semantics and recovery

- Configured lounges use authenticated server transactions for check-in,
  realtime deductions and checkout. Other lounges retain their existing flow.
  Rules protect visit pointers/hour counters without disabling the existing
  permissions for unrelated wallet consumption (such as shopping).
- The scheduled job checks due visits and stock settlements, retries in the
  next round, and exits financial processing early after a clean completion.
  Each pass has a processing budget; unresolved work remains visible.
- Checkout is effective at the first 23:00 after check-in, or an earlier frozen
  checkout request. A late retry never charges until its actual execution time.
  Ledger `createdAt` is the actual settlement time; `effectiveAt` is the cutoff.
- Closing can make the wallet negative. A reload raises that balance normally;
  there is no second debt deduction. Fees are not waived.
- The existing first-hour/half-hour boundary charging policy is unchanged.
  Day Pass snapshots and membership waivers are retained.
- Pending cigar choices remain pending and continue to occupy quota. Only
  confirmed choices create stock-out movements. Later administrator selections
  use the same server stock reconciliation without repeating wallet settlement.
- Dashboard and Lounge Operations expose the latest 14 batches, read-only
  preview, report submission state and confirmed manual retry. Refresh after
  queueing a job. A retry creates a new report revision, not a repeat charge.
- Three scheduled rounds are not a perpetual watchdog. A missed invocation,
  dispatch error, timeout or unresolved third round needs an operator to inspect
  the batch and retry. Earlier business dates can be retried from that list.
  No automatic unbounded retries or hidden background loop is installed.
- Reports are immutable versioned snapshots. Submission, delivery and reading
  are different states. Transport ambiguity stays `unknown`; never blindly resend.
  Whapi receipt tracking is shared with the existing sending records.
- Debt is replayed FIFO from wallet transactions with checkpoints. Historical
  imports marked as not affecting balances and cumulative summaries are excluded.
  Missing checkpoints/gaps/ambiguous ordering require review; they are not counted
  as zero debt or assigned to a lounge. Unknown origins remain network-wide
  unallocated historical debt. Figures explicitly cover reconciled wallets only.
- Snapshot debt activity runs from the business day's midnight to report creation,
  including closing settlements. A late recovery report is explicitly labelled
  when its snapshot includes later days. It cannot recreate a missing original
  day-end snapshot. Recharge and historical debt are never retroactively edited.
- Report scans are paginated and fail visibly above 10,000 documents per source;
  larger installations need incremental ledger projections before rollout.
- Disabling the server switch fails closed for configured lounges. Finish open
  visits and disable the lounge switch before reverting to legacy clients/rules.
- This does not cancel room bookings or implement room-session closing.

## Local verification

### Independent Test Daily Report

Open System Config / Lounges / Lounge Operations / Test Daily Report. Choose a
date up to today and preview the English `[TEST]` snapshot before confirming.
This path works without enabling scheduled closing or automatic daily reports.
It still requires the local Functions backend (for localhost), valid server
credentials, WhatsApp business sending enabled, and a verified connected Whapi
channel. An optional saved lounge channel must match the active verified channel.

Only the verified channel's own `user.id` can receive the message. The client
cannot override its text, destination or channel. Test previews expire after
15 minutes; the same preview can be submitted only once, with a one-minute
per-operator/per-lounge send throttle. Check delivery status instead of resending
when a request is ambiguous. Generating a new preview is a separate explicit test.

Preview/send writes only `_loungeTestReports` and the existing WhatsApp delivery
records. It does not run checkout, debit wallets, move inventory or change official
closing batches/report snapshots. Test reports reflect current recorded data;
historical-date debt snapshots can include later activity and are labelled as such.
Private test drafts are server-only; no Firestore client-rule changes are required.

Run `npx vitest run src/utils/loungeOperations.test.ts src/utils/loungeDebt.test.ts
netlify/tests/loungeVisits.test.ts` (one line).

The isolated emulator test is opt-in with
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8089` and project `demo-lounge`:
`npx vitest run netlify/tests/loungeOperations.emulator.test.ts`.
Never point these tests at production. Netlify Dev does not execute cron schedules;
local UI requires the Functions backend as well as Vite.
