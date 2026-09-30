const path = require('node:path');

try {
  process.loadEnvFile(path.resolve(__dirname, '../../.env.local'));
} catch {
  // EAS and production builds provide these values through environment variables.
}

module.exports = {
  expo: {
    name: 'Macanudo Socials',
    slug: 'macanudo-socials',
    version: '0.1.0',
    platforms: ['ios', 'android'],
    orientation: 'portrait',
    icon: './assets/images/app-logo-512.png',
    scheme: 'macanudosocials',
    userInterfaceStyle: 'dark',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.macanudosocials.app',
    },
    android: {
      package: 'com.macanudosocials.app',
      googleServicesFile: './google-services.json',
      adaptiveIcon: {
        foregroundImage: './assets/images/app-logo-maskable-512.png',
        backgroundColor: '#11110f',
      },
      permissions: ['POST_NOTIFICATIONS'],
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          image: './assets/images/app-logo-192.png',
          imageWidth: 128,
          resizeMode: 'contain',
          backgroundColor: '#11110f',
        },
      ],
      [
        'expo-notifications',
        {
          icon: './assets/images/notification-badge-96.png',
          color: '#d6a63c',
          defaultChannel: 'default',
        },
      ],
    ],
    experiments: { typedRoutes: true },
    extra: {
      firebase: {
        apiKey: process.env.VITE_FIREBASE_API_KEY,
        authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: process.env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.VITE_FIREBASE_APP_ID,
      },
    },
  },
};
