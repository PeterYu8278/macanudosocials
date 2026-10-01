# Phone And Password Login

Phone/password sign-in uses `/.netlify/functions/phone-login`. It does not allow anonymous Firestore user queries and does not require the Firebase SMS Phone provider.

The function privately resolves the normalized phone, verifies the existing password through Firebase Authentication, verifies the resulting ID token, and issues a custom token for the same Auth UID. Missing accounts and incorrect passwords return the same error. MFA-pending responses do not issue a session. Requests are limited per IP and phone using private `_phoneLoginAttempts` records; configure Firestore TTL on `expiresAt` to clean up expired records.

## Configuration

- `FIREBASE_SERVICE_ACCOUNT`: existing Firebase Admin service account JSON, configured only in server-side Netlify environment variables or local untracked environment files. Never use a `VITE_` prefix or commit credentials.
- `FIREBASE_WEB_API_KEY` or `VITE_FIREBASE_API_KEY`: Firebase Auth API key for the same project. If the browser key is referrer-restricted, use a separate server-compatible key restricted to the Identity Toolkit API.

Deploy the new function together with the frontend. For local development, run a Netlify functions server on port 8888 (`netlify functions:serve --port 8888`) with those environment variables; the existing Vite server on port 3000 already proxies `/.netlify/functions` to it.

Real-account verification requires a configured backend and valid account credentials. Automated tests mock Firebase and never submit real passwords or send SMS.
