# Macanudo Socials Mobile

Expo React Native client for the existing Macanudo Socials Firebase and Netlify backend.

## Local development

The app config loads Firebase values from the repository root `.env.local` file.

```powershell
cd apps/mobile
npm install
npx expo run:android
```

Use a development build or native Android build when testing FCM. Expo Go does not provide the production native push-token behavior used by this app.

## Verification

```powershell
npm run typecheck
npm run export:android
```

## APK and production bundle

```powershell
npx eas-cli build --platform android --profile preview
npx eas-cli build --platform android --profile production
```

The Android application ID is `com.macanudosocials.app`, matching the checked-in Firebase Android configuration. It replaces the existing Capacitor Android app and cannot be installed alongside an app with the same ID.
