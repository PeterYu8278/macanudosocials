import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Platform } from 'react-native';

import { db } from '@/lib/firebase';

const DEVICE_ID_KEY = 'macanudo-native-device-id';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function getDeviceId() {
  const current = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (current) return current;
  const next = `native-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

export async function getPushPermissionGranted() {
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted;
}

export async function registerNativePushToken(userId: string) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Macanudo Socials',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#D6A63C',
      sound: 'default',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Notification permission was not granted.');

  const token = (await Notifications.getDevicePushTokenAsync()).data;
  if (typeof token !== 'string' || !token) throw new Error('The device did not return an FCM token.');

  const deviceId = await getDeviceId();
  await setDoc(
    doc(db, 'users', userId, 'fcmTokens', deviceId),
    {
      token,
      deviceId,
      active: true,
      provider: 'fcm',
      platform: Platform.OS,
      device: 'native',
      lastUsed: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  return token;
}

export async function disableNativePushToken(userId: string) {
  const deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) return;
  await setDoc(
    doc(db, 'users', userId, 'fcmTokens', deviceId),
    { active: false, updatedAt: serverTimestamp() },
    { merge: true },
  );
}
