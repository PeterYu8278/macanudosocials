# Website traffic monitoring

Location: Feature Management → System Settings → System Monitoring → Website Traffic.

The Firestore usage tab remains independent. Browser traffic starts only after deployment; old PV/UV cannot be reconstructed from Firestore reads. Production collection is restricted to macanudosocials.com and www.macanudosocials.com, and browser Do Not Track / the privacy opt-out are respected. Guest Page and Profile preferences contain the browser privacy control.

## Collection and definitions

- The tracker sits inside the route Suspense boundary. It distinguishes signed-out Guest Page from signed-in Home, excludes staff roles, admin/developer pages and non-production hosts, and deduplicates StrictMode remounts by navigation key. Reloading the document creates another page view.
- A random browser ID persists locally. Session IDs expire after 30 minutes without tracked interaction; key, pointer and scrolling activity renews the inactivity clock. IDs are not fingerprints or person counts.
- Front-visible time of 10 seconds, a contact click or registration interaction creates one engaged-session event. Registration start is counted once per session.
- Events are queued locally (maximum 100 / 24 hours), sent in batches of 20 and retried with the same IDs using backoff. Acknowledged events are removed. Invalid batches are discarded; after five transient failures a batch is discarded and collection delivery pauses for five minutes before trying newer events. Optional telemetry errors never fail account registration. An anonymous public endpoint cannot guarantee bot-free or fraud-proof counts.
- The ingestion function validates event types, size, times, fixed page/source dimensions, origin and known bot UAs. Browser clients cannot submit conversion events. Native Netlify rate limiting caps ingress requests per IP/domain. No full IP, full URL, referrer URL, email, phone, form contents or raw browser IDs are persisted in event receipts.
- Each event receipt and hourly summary is committed atomically. Hourly summaries have four deterministic shards, fixed page/source counters and mergeable HLL-1024 sketches. PV and event counters are deduplicated counts. UV and sessions are estimates (approximately 3.25% standard error); sketches are merged across the selected range, not summed by day. UTM campaign dimensions are capped at 32 per shard/hour and 500 per report; excess labels are grouped into Other campaigns without losing their counters. The conversion activity tab shows period event counts, not a same-cohort rate.

## Backend conversions and attribution

The scheduled `website-conversions` function runs every five minutes on published Netlify deployments. It reads new user records and **paid initial** membership fee records. Browser clicks do not create successful registrations or activations. Historical imports with old event dates are not manufactured into current conversions. Monetary values and membership state are never modified.

The worker uses an eight-minute lease, an 18-second processing budget, bounded pages and durable timestamp/document-ID cursors. A partially processed window resumes on the next run. Checkpoints advance only after both streams finish. Event receipts prevent overlap/retry duplication; warnings and the checked-through timestamp expose failures and backlog.

Website registration optionally stores allowlisted first-touch attribution in the private `_websiteAttribution` collection, atomically with account creation. Registration and initial activation may reuse it within 30 days. Unlinked conversions are **Unknown**, not Direct. Registrations without a website lounge are **Unassigned / system-wide**; paid activations use the fee's store ID when known. A period's registrations and activations are event totals, not a same-cohort conversion rate. AI referrers are detected sources, not proof of recommendations. Search Console impressions/search terms are not integrated by this change.

## Storage and deployment

Collections are declared in `globalCollections.ts`. Existing default-deny Firestore rules keep them inaccessible to browser SDKs; reports are served only after Firebase ID-token and role verification (developer/superAdmin/admin). The UI currently lives on the developer feature-management route.

1. Deploy the web app and Netlify functions, with the existing `FIREBASE_SERVICE_ACCOUNT` in Functions scope. No additional credential is needed.
2. `WEBSITE_TRAFFIC_ENABLED=false` stops ingestion and the conversion worker. `VITE_WEBSITE_TRAFFIC_ENABLED=false` disables browser tracking at build time. Defaults are enabled on production only; previews do not collect browser events.
3. Review and deploy the repository's Firestore index configuration, preserving existing remote indexes. `firestore.indexes.json` includes TTL policies and index exemptions for traffic summaries. Until TTL policies are enabled in Firebase, expiry fields alone do **not** delete documents.
4. TTL retention: browser receipts 90 days; conversion receipts and hourly aggregates 400 days; attribution 31 days. TTL deletion is asynchronous. Conversion receipts are retained as long as summaries for retry safety. TTL deletions incur Firestore operations.
5. Confirm `website-conversions` is listed with its five-minute schedule in the published deploy. Local Netlify Dev does not run schedules automatically; invoke it manually for local debugging. The Vite `/api/website-traffic` proxy targets local functions on port 8888. Local browser visits are intentionally excluded.
6. From a signed-out, non-DNT browser on the production domain, view Guest Page, then inspect the report after about one minute. Revisit/refresh, click contact, and verify that PV rises while unique estimates remain stable. Confirm a real test registration only with an authorized test account; do not activate paid memberships just to test telemetry.

Reports use MYT date boundaries, accept at most 31 days, and read at most 4096 summary documents. An explicit incomplete-result warning is returned when capped. Both client and server cache reports for 60 seconds; the visible dashboard refreshes every 65 seconds. Empty results, unavailable results and conversion backlog are distinct UI states. Collection/function/Firestore usage is not free or guaranteed to stay inside free quotas.
