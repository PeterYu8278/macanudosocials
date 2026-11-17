# AGENTS.md

This file is the operating guide for agents working in this repository.

## Project Snapshot

- Product: Macanudo Socials / Cigar Club membership and operations platform.
- Main app: React 19 + TypeScript + Vite 7 PWA.
- UI: Ant Design 5 with `@ant-design/v5-patch-for-react-19`.
- Routing: React Router 7.
- State: Zustand, especially `src/store/modules/*`.
- Backend: Firebase Auth + Firestore from the browser, Firebase Admin inside Netlify Functions.
- Hosting/functions: Netlify. Functions live in `netlify/functions`.
- Images/media: Cloudinary plus app-managed public assets.
- i18n: i18next with `zh-CN` and `en-US`.
- Mobile surfaces: Capacitor/iOS under `ios/`, Expo/React Native under `apps/mobile`, Flutter under `apps/flutter_mobile`.

Trust live files over older docs. Some docs still mention React 18 / Router v6; `package.json`, `vite.config.ts`, and source code are the current source of truth.

## First Moves

- Read before editing. Start with `package.json`, `vite.config.ts`, `src/App.tsx`, and the specific module you will touch.
- Use `rg` / `rg --files` for search.
- Check `git status --short` before changes. This repo may already contain user work; do not revert or reformat unrelated files.
- Keep edits scoped. Do not create cleanup commits, broad refactors, or documentation files unless the task asks for them.
- Do not edit generated/build output such as `dist/`, `node_modules/`, `.netlify/`, or native build artifacts.

## Commands

- Install dependencies: `npm install`
- Dev server: `npm run dev`
- Netlify local dev: `npm run netlify`
- Serve functions only: `npm run functions`
- Production build with typecheck: `npm run build`
- Fast Netlify-style build: `npm run build:fast`
- Preview build: `npm run preview`
- Run targeted tests: `npx vitest run path/to/file.test.ts`

There is no top-level `npm test` script at the time of writing. Use `npx vitest run` for relevant tests.

## Validation Rules

- For TypeScript or app-wide changes, prefer `npm run build` when feasible.
- For narrow logic changes, run the closest `*.test.ts` / `*.test.tsx` with `npx vitest run`.
- For Netlify Function changes, run the matching tests in `netlify/tests`.
- For Firestore rule-sensitive changes, inspect `firestore.rules` and existing `*.rules.test.ts` coverage.
- If a full build is too slow or blocked by unrelated errors, report that clearly and include the targeted checks you did run.

## Source Layout

- `src/views/frontend`: member/user-facing pages.
- `src/views/admin`: admin and developer pages.
- `src/components/common`: shared UI primitives and reusable app components.
- `src/components/layout`: shell, sider, footer, and mobile navigation.
- `src/services/firebase`: Firestore-facing browser services.
- `src/services/api`: API wrapper services.
- `src/services/cloudinary`: Cloudinary helpers.
- `src/services/gemini`, `src/services/groq`, `src/services/whapi`: AI/search/messaging integrations.
- `src/hooks`: shared React hooks. Read `src/hooks/README.md` before adding new loading/drawer/delete patterns.
- `src/utils`: pure utilities and business calculations.
- `src/types`: shared TypeScript domain types.
- `src/config`: Firebase/env/theme/permissions/global collection constants.
- `src/i18n`: translation setup, constants, and locale JSON files.
- `netlify/functions`: serverless endpoints.
- `public`: PWA icons, service worker files, manifest assets.

## Coding Style

- Use TypeScript strict-mode friendly code.
- Prefer functional React components and hooks.
- Follow existing import alias style: `@/*` maps to `src/*`.
- Prefer existing hooks/components before adding new abstractions.
- Keep business logic in services/utils where possible; keep views focused on UI orchestration.
- Use Ant Design components consistently for admin and operational UI.
- Avoid unnecessary console logging in production paths. Existing debug logs are not a license to add more.
- Comments should explain non-obvious business or platform constraints, not restate code.

## Internationalization

- All user-facing text in React UI should go through i18next.
- Keep `src/i18n/locales/zh-CN.json` and `src/i18n/locales/en-US.json` in sync.
- Prefer translation constants from `src/i18n/constants.ts` when available.
- For common labels/actions/statuses, prefer `useCommonTranslation`.
- Do not add only one language unless the task is explicitly a temporary spike.

## Auth, Roles, Permissions

- Roles currently include `guest`, `member`, `vip`, `storeAdmin`, `admin`, `superAdmin`, and `developer`.
- Route access is enforced both in `src/App.tsx` via `ProtectedRoute` and in `src/config/permissions.ts`.
- When adding or changing routes, update both routing and permission definitions as needed.
- Feature visibility is managed through `src/services/firebase/featureVisibility.ts` and app config collections; do not hard-code visibility where a managed feature flag already exists.

## Firestore Rules And Data

- Use collection names from `src/config/globalCollections.ts`; avoid string-literal collection IDs in new code.
- Use existing Firestore service helpers and sanitizers, especially `sanitizeForFirestore`, `toDateOrNull`, and `convertFirestoreTimestamps`.
- Never write `undefined` to Firestore. Sanitize nested objects before writes.
- Be careful with Firestore composite indexes. Existing code sometimes sorts in memory to avoid index requirements; preserve that tradeoff unless intentionally changing it.
- For write flows that touch related documents, preserve audit logging and linked records.
- Inventory architecture uses order-level records plus `inventory_movements`. Inbound/outbound create/update/delete paths must keep movements synchronized.
- Do not bypass transactions for workflows that need uniqueness, point balances, registrations, or concurrent safety.

## Netlify Functions

- Function source lives in `netlify/functions`.
- Shared server-side helpers live in `netlify/functions/_shared`.
- Browser code must not import Firebase Admin or server-only helpers.
- Serverless functions depend on environment variables such as `FIREBASE_SERVICE_ACCOUNT`; never commit secrets.
- When changing an endpoint, check its matching test in `netlify/tests` and any frontend caller under `src/services` or views.

## PWA, Push, And Service Workers

- PWA registration is owned by `src/utils/pwa.ts`; `vite.config.ts` intentionally sets `injectRegister: null`.
- `src/sw.ts`, `public/firebase-messaging-sw.js`, and `public/push/onesignal/OneSignalSDKWorker.js` have separate responsibilities. Do not merge them casually.
- Netlify headers intentionally prevent long-lived caching for service workers. Preserve this unless fixing a well-understood PWA cache issue.
- Development mode unregisters service workers in `src/main.tsx`; production initializes PWA.

## Payments, Membership, Points

- Payment and subscription config is part of app config and payment types under `src/types/payment.ts`.
- Points, visit sessions, reloads, membership fees, and redemption flows are tightly coupled. Search existing tests before changing these.
- Preserve idempotency in payment callbacks, membership activation, pending checkout processing, and scheduled jobs.
- Use exact monetary/points semantics from existing utils; do not introduce floating point shortcuts in billing logic.

## UI And Responsive Behavior

- The app shell has special layout logic in `src/App.tsx` for landing, auth pages, desktop/tablet sider, mobile nav, and fixed viewport height.
- For new pages, check whether they need app padding or no-padding behavior.
- Admin pages should feel operational and scan-friendly. Reuse tables, filters, drawers, cards, tags, and shared buttons.
- Mobile user-facing pages must remain touch-friendly and fit within the bottom navigation layout.

### Brand Colors

- Use the shared gold gradient for branded interactive fills and selected accents:
  `var(--cigar-gradient-gold)` (`#FDE08D` to `#C48D3A`). Use the corresponding
  `--cigar-gradient-gold-hover` and `--cigar-gradient-gold-active` variables for states.
- Ant Design checked Switch controls and selected Tabs text/indicators inherit
  this finish globally from `src/style.css`; do not require per-page opt-in classes.
- `gold-switch` remains compatible with the global Switch styling.
  `cigar-equal-tabs` is a layout option, not a requirement for gold Tabs colors.
- Keep disabled/off controls muted. Preserve error, warning, success and other
  semantic colors; never replace them indiscriminately with branded gold.
- Ant Design theme tokens require solid colors, not CSS gradients. Use compatible
  gold fallbacks in `src/config/theme.ts`; apply gradients through shared CSS.
  Icons and unsupported text-clipping fallbacks may use solid `#FDE08D`.
- Reuse shared variables instead of adding page-local gold hex values, inline
  gradients or new competing color classes. Verify selected, hover, disabled and
  keyboard-focus states when changing shared styles.

## Mobile Subprojects

- `apps/mobile` is an Expo/React Native app with its own `package.json`.
- `apps/flutter_mobile` is a Flutter app with its own `pubspec.yaml`.
- Root web changes do not automatically update mobile apps. If the task changes shared product behavior, inspect whether mobile surfaces also need updates.
- Do not run native build commands or edit platform-generated files unless the task explicitly targets mobile/native.

## Environment And Secrets

- `.env.local`, service account files, Firebase keys, Netlify env values, and mobile `google-services.json` may contain sensitive data. Do not print or commit secrets.
- Use `env.example` as the public reference for environment shape.
- If a task requires unavailable credentials or live services, stop at the boundary and report exactly what is missing.

## Documentation

- Docs under `docs/` are useful historical context, especially for FCM, Netlify, image upload, membership, phone login/reset, and AI cigar recognition.
- Prefer updating docs only when behavior or setup instructions changed.
- Do not treat docs as more authoritative than current code and config.

## Git Hygiene

- Preserve user changes. Never use `git reset --hard` or checkout files unless explicitly requested.
- Do not commit unless the user asks.
- Keep generated files out of changes unless the task requires generated artifacts.
- If you touch files that already had user edits, reread them and merge carefully instead of overwriting.

## Reporting Back

- Summarize what changed, where, and how it was verified.
- Mention tests/builds that were not run.
- Surface risks around production data, payments, permissions, or notifications plainly.
