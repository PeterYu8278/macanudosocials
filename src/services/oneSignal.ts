import OneSignal from 'react-onesignal'
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { db } from '../config/firebase'
import type { User } from '../types'
import type { PushSubscriptionSnapshot } from '../store/modules/pushNotifications'

export const ONESIGNAL_APP_ID = 'af46548f-181c-40e3-8880-0aae079c20a3'
const ONESIGNAL_WORKER_PATH = 'push/onesignal/OneSignalSDKWorker.js'
const ONESIGNAL_WORKER_SCOPE = '/push/onesignal/'
const ONESIGNAL_SITE_ORIGIN = 'https://macanudosocials.com'
const DEVICE_ID_STORAGE_KEY = 'macanudo_push_device_id'

let initializationPromise: Promise<void> | null = null

export const isOneSignalOrigin = () =>
  typeof window !== 'undefined' && window.location.origin === ONESIGNAL_SITE_ORIGIN

export const initializeOneSignal = (): Promise<void> => {
  if (!isOneSignalOrigin()) {
    return Promise.reject(new Error('OneSignal is only enabled on the production origin'))
  }

  if (!initializationPromise) {
    OneSignal.Debug.setLogLevel(import.meta.env.DEV ? 'warn' : 'error')
    initializationPromise = OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      serviceWorkerPath: ONESIGNAL_WORKER_PATH,
      serviceWorkerParam: { scope: ONESIGNAL_WORKER_SCOPE },
    }).catch((error: unknown) => {
      initializationPromise = null
      throw error
    })
  }

  return initializationPromise
}

export const getOneSignalLanguage = (locale?: string): string =>
  locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'

type DeviceType = 'mobile' | 'tablet' | 'desktop'
type OperatingSystem = 'ios' | 'android' | 'windows' | 'macos' | 'linux'
type Browser = 'safari' | 'chrome' | 'edge' | 'firefox'

export const getDeviceTags = (): {
  device: DeviceType
  os?: OperatingSystem
  browser?: Browser
} => {
  const userAgent = navigator.userAgent.toLowerCase()
  const isIPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  const isTablet = isIPadOS || /ipad|tablet|kindle|silk|playbook/.test(userAgent) ||
    (/android/.test(userAgent) && !/mobile/.test(userAgent))
  const isMobile = !isTablet && /mobile|iphone|ipod|android/.test(userAgent)

  let os: OperatingSystem | undefined
  if (isIPadOS || /iphone|ipad|ipod/.test(userAgent)) os = 'ios'
  else if (/android/.test(userAgent)) os = 'android'
  else if (/windows/.test(userAgent)) os = 'windows'
  else if (/macintosh|mac os x/.test(userAgent)) os = 'macos'
  else if (/linux/.test(userAgent)) os = 'linux'

  let browser: Browser | undefined
  if (/edg\//.test(userAgent)) browser = 'edge'
  else if (/firefox|fxios/.test(userAgent)) browser = 'firefox'
  else if (/chrome|crios/.test(userAgent)) browser = 'chrome'
  else if (/safari/.test(userAgent)) browser = 'safari'

  return {
    device: isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop',
    os,
    browser,
  }
}

const createDeviceId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const getPushDeviceId = (): string => {
  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)
  if (existing) return existing

  const deviceId = createDeviceId()
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId)
  return deviceId
}

export const readPushSubscriptionSnapshot = (): PushSubscriptionSnapshot => {
  if (!isOneSignalOrigin() || !OneSignal.Notifications.isPushSupported()) {
    return {
      status: 'unsupported',
      permission: 'default',
      optedIn: false,
      subscriptionId: null,
      supported: false,
    }
  }

  const permission = OneSignal.Notifications.permissionNative
  const optedIn = OneSignal.User.PushSubscription.optedIn === true
  const subscriptionId = OneSignal.User.PushSubscription.id || null

  let status: PushSubscriptionSnapshot['status'] = 'unsubscribed'
  if (permission === 'denied') status = 'denied'
  else if (permission === 'default') status = 'prompt'
  else if (permission === 'granted' && optedIn && subscriptionId) status = 'subscribed'

  return { status, permission, optedIn, subscriptionId, supported: true }
}

export const requestPushSubscription = async (): Promise<PushSubscriptionSnapshot> => {
  await initializeOneSignal()

  if (OneSignal.Notifications.permissionNative === 'default') {
    await OneSignal.Notifications.requestPermission()
  }
  if (OneSignal.Notifications.permissionNative === 'granted' && !OneSignal.User.PushSubscription.optedIn) {
    await OneSignal.User.PushSubscription.optIn()
  }

  return readPushSubscriptionSnapshot()
}

export const disablePushSubscription = async (): Promise<PushSubscriptionSnapshot> => {
  await initializeOneSignal()
  if (OneSignal.User.PushSubscription.optedIn) {
    await OneSignal.User.PushSubscription.optOut()
  }
  return readPushSubscriptionSnapshot()
}

export const syncPushSubscriptionToFirestore = async (
  user: User,
  snapshot: PushSubscriptionSnapshot,
): Promise<void> => {
  if (!isOneSignalOrigin() || !user.id) return

  const deviceId = getPushDeviceId()
  const deviceTags = getDeviceTags()
  const subscriptionsRef = collection(db, 'users', user.id, 'notificationSubscriptions')

  await setDoc(doc(subscriptionsRef, deviceId), {
    provider: 'onesignal',
    deviceId,
    subscriptionId: snapshot.subscriptionId,
    permission: snapshot.permission,
    status: snapshot.status,
    optedIn: snapshot.optedIn,
    supported: snapshot.supported,
    ...deviceTags,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  const deviceSnapshots = await getDocs(subscriptionsRef)
  const activeDeviceCount = deviceSnapshots.docs.filter((entry) => {
    const data = entry.data()
    return data.status === 'subscribed' && data.optedIn === true
  }).length

  await setDoc(doc(db, 'users', user.id), {
    notificationSummary: {
      provider: 'onesignal',
      hasActiveSubscription: activeDeviceCount > 0,
      activeDeviceCount,
      currentDeviceId: deviceId,
      currentDeviceStatus: snapshot.status,
      currentSubscriptionId: snapshot.subscriptionId,
      currentDeviceType: deviceTags.device,
      currentOs: deviceTags.os || null,
      currentBrowser: deviceTags.browser || null,
      permission: snapshot.permission,
      optedIn: snapshot.optedIn,
      lastSyncedAt: serverTimestamp(),
    },
  }, { merge: true })
}

export const subscribeToOneSignalChanges = (
  listener: (snapshot: PushSubscriptionSnapshot) => void,
): (() => void) => {
  const handleChange = () => listener(readPushSubscriptionSnapshot())

  OneSignal.User.PushSubscription.addEventListener('change', handleChange)
  OneSignal.Notifications.addEventListener('permissionChange', handleChange)

  return () => {
    OneSignal.User.PushSubscription.removeEventListener('change', handleChange)
    OneSignal.Notifications.removeEventListener('permissionChange', handleChange)
  }
}
