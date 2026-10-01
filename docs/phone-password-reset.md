# Phone password recovery

The anonymous reset form calls `/.netlify/functions/phone-password-reset`.
It never queries Firestore in the browser or changes a password immediately.
The backend resolves the registered phone privately, generates a Firebase
password reset link, and sends it only to that phone through WhatsApp.
The link and account email are never returned to the requesting browser.

Deployment requires `FIREBASE_SERVICE_ACCOUNT` in Netlify and an enabled
`app_config/default.whapi` configuration with `apiToken`. Only the HTTPS
`gate.whapi.cloud` provider is accepted. No anonymous Firestore rule changes
are required. Local testing needs Netlify Dev, not a standalone Vite server.

Requests are limited to five per phone and per client IP in five minutes.
Unknown or ambiguous phone numbers receive the same success response as
accepted requests. Sending failure leaves the existing password unchanged.
The user completes the password change on Firebase's reset-link page.

The legacy direct `reset-password` function now requires a verified Firebase
bearer token and an `admin`, `superAdmin`, or `developer` role. The authenticated
admin-only manual message workflow supplies this token.

Tests use mocked Firebase and WhatsApp services. Do not send real recovery
messages or change real credentials as part of automated verification.
