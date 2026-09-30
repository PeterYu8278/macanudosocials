# React Native Migration Architecture

## Repository layout

- `src/`: existing React web and PWA client; remains production-safe during migration.
- `apps/mobile/`: Expo React Native client for Android and iOS.
- `packages/shared/`: platform-neutral types, constants, validation, and business rules.
- `netlify/functions/`: shared server-side notification and automation endpoints.

Do not import web components, Ant Design, browser service workers, or DOM utilities into the mobile app. Move only platform-neutral logic into `packages/shared`.

## Data and authentication

Both clients use the same Firebase project, Authentication users, Firestore collections, Storage assets, and server functions. The mobile client reads the existing `users` and `events` schemas rather than maintaining a second database.

The first mobile slice supports Firebase email/password authentication. Phone authentication should be added as a native flow instead of querying user records before authentication.

## Push notifications

The mobile client uses `expo-notifications` to obtain the native Android FCM token. Each installation writes one active document to:

`users/{userId}/fcmTokens/{deviceId}`

The document includes `token`, `deviceId`, `active`, `provider`, `platform`, and timestamps. Existing Netlify notification functions already read active documents from this collection, so published event, announcement, reminder, and targeted sends can reach the native app without a separate delivery backend.

Disabling notifications marks the current installation inactive. OS permission revocation must still be performed in device settings after permission has been permanently denied.

## Release strategy

1. Build internal Android APKs with the EAS `preview` profile.
2. Validate login, Firestore reads, token registration, background delivery, and notification taps on physical devices.
3. Port member workflows one module at a time: membership card, event details and registration, visits and redemption, profile editing, then administration where needed.
4. Add deep-link routing to notification destinations.
5. Replace the Capacitor release only after the React Native app reaches feature parity.

The mobile application ID is `com.macanudosocials.app`. It matches the existing Firebase Android client and is intentionally a replacement for the current APK, not a side-by-side installation.
