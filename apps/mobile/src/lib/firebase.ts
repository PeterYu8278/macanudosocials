import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as FirebaseAuthModule from 'firebase/auth';
import {
  getAuth,
  initializeAuth,
  type Auth,
  type Persistence,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

interface FirebaseExtra {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

const firebaseConfig = (Constants.expoConfig?.extra?.firebase ?? {}) as FirebaseExtra;
const requiredKeys: Array<keyof FirebaseExtra> = ['apiKey', 'projectId', 'appId'];
const missingKeys = requiredKeys.filter((key) => !firebaseConfig[key]);

if (missingKeys.length > 0) {
  throw new Error(`Missing Firebase configuration: ${missingKeys.join(', ')}`);
}

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Firebase exposes this only under its React Native export condition.
const getReactNativePersistence = (
  FirebaseAuthModule as typeof FirebaseAuthModule & {
    getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
  }
).getReactNativePersistence;

let auth: Auth;
try {
  auth = initializeAuth(firebaseApp, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  auth = getAuth(firebaseApp);
}

export { auth };
export const db = getFirestore(firebaseApp);
