# Redemption Statistics

This isolated Firebase Functions codebase complements Netlify Functions. It observes every
`redemptionRecords/{sessionId}` write, including browser changes, Day Pass writes and legacy
import/cleanup. It never modifies points, inventory, source redemptions or membership dates.

## Deployment

Firebase Functions requires a billing-enabled project and appropriate deploy permissions.
Confirm that `asia-southeast1` is appropriate for the Firestore database before deployment.

```powershell
cd firebase-functions
npm ci
cd ..
npx firebase-tools deploy --only functions:redemption-projections,firestore:rules --project macanudosocial
```

Deploy the trigger and rules before publishing the frontend. Do not upload service account files.
Then initialize history from the repository root using existing server credentials:

```powershell
node scripts/backfill-redemption-stats.cjs
node scripts/backfill-redemption-stats.cjs --apply --trigger-deployed
```

The first command only previews totals. Review unresolved owners before applying. Apply scans all
source documents in pages, synchronizes idempotent checkpoints and verifies per-user totals.
If ownership cannot be resolved or the run fails, readiness remains false. Re-running is safe.
No user records or point balances are changed. Run during a quiet period and retain normal backups.

## Consistency

- `_redemptionStats/{userId}` contains completed and pending quantities.
- `_redemptionStatsSources/{sessionId}` is a server-only per-source checkpoint.
- `_redemptionStatsMeta/default.ready` is published only after a successful historical backfill.
- Counts exclude Day Pass, referral rewards, cancelled/rejected entries and invalid quantities.
- Missing legacy status means completed; missing document ownership is resolved from its visit.
- The trigger reads current source state inside the checkpoint/counter transaction. Duplicate and
  out-of-order notifications cannot apply an event twice; owner changes adjust both users.
- This is an eventually consistent display projection, not a replacement for redemption admission
  checks. A write can appear in the summary a short time after it is committed.
- The homepage listens to metadata and its user's counter only for this displayed number. Existing
  quota/cooldown checks remain independent. Unknown/error states display a placeholder, not zero.

`reconcileUserStats` also provides a read-only checkpoint total or a transactional counter repair.
If a trigger could not process a record, resolve the error and rerun the backfill.
