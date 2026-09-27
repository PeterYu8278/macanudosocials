import OneSignal, { LogLevel, type NotificationClickEvent } from 'onesignal-cordova-plugin'
import type { PushSubscriptionSnapshot } from '../store/modules/pushNotifications'
import type { User } from '../types'
import { normalizePhoneNumber } from '../utils/phoneNormalization'
import { getDeviceTags, getOneSignalLanguage, ONESIGNAL_APP_ID } from './oneSignal'

let initialized = false
const NOTIFICATION_PERMISSION_PROMPT_TRIGGER = 'notification_permission_prompt'

export const initializeNativeOneSignal = () => {
  if (initialized) return
  OneSignal.Debug.setLogLevel(import.meta.env.DEV ? LogLevel.Warn : LogLevel.Error)
  OneSignal.initialize(ONESIGNAL_APP_ID)
  initialized = true
}

export const readNativePushSubscriptionSnapshot = async (): Promise<PushSubscriptionSnapshot> => {
  initializeNativeOneSignal()
  const [permissionGranted, canRequestPermission, optedIn, subscriptionId] = await Promise.all([
    OneSignal.Notifications.getPermissionAsync(),
    OneSignal.Notifications.canRequestPermission(),
    OneSignal.User.pushSubscription.getOptedInAsync(),
    OneSignal.User.pushSubscription.getIdAsync(),
  ])

  const permission: NotificationPermission = permissionGranted
    ? 'granted'
    : canRequestPermission
      ? 'default'
      : 'denied'
  const status: PushSubscriptionSnapshot['status'] = permissionGranted && optedIn && subscriptionId
    ? 'subscribed'
    : permissionGranted
      ? 'unsubscribed'
      : 'prompt'

  return {
    status,
    permission,
    optedIn,
    subscriptionId,
    supported: true,
  }
}

export const configureNativeOneSignalUser = async (user: User) => {
  initializeNativeOneSignal()
  OneSignal.login(user.id)

  const email = user.email?.trim().toLowerCase()
  const phone = normalizePhoneNumber(user.phone || user.profile?.phone || '')
  const deviceTags = getDeviceTags()

  OneSignal.User.setLanguage(getOneSignalLanguage(user.preferences?.locale))
  if (email) OneSignal.User.addEmail(email)
  if (phone) OneSignal.User.addSms(phone)
  OneSignal.User.removeTags(['store_id', 'phone'])
  OneSignal.User.addTags({
    role: user.role,
    name: user.displayName || email?.split('@')[0] || user.id,
    device: deviceTags.device,
    ...(deviceTags.os ? { os: deviceTags.os } : {}),
    ...(deviceTags.browser ? { browser: deviceTags.browser } : {}),
    ...(user.memberId ? { member_id: user.memberId } : {}),
  })
}

export const syncNativeNotificationPermissionPrompt = (
  snapshot: PushSubscriptionSnapshot,
  notificationsEnabled: boolean,
) => {
  initializeNativeOneSignal()
  const shouldShowPrompt = notificationsEnabled && snapshot.permission === 'default'

  if (shouldShowPrompt) {
    OneSignal.InAppMessages.addTrigger(NOTIFICATION_PERMISSION_PROMPT_TRIGGER, 'show')
    return
  }

  OneSignal.InAppMessages.removeTrigger(NOTIFICATION_PERMISSION_PROMPT_TRIGGER)
}

export const requestNativePushSubscription = async (): Promise<PushSubscriptionSnapshot> => {
  initializeNativeOneSignal()
  const hasPermission = await OneSignal.Notifications.getPermissionAsync()
  if (!hasPermission) await OneSignal.Notifications.requestPermission(true)
  OneSignal.User.pushSubscription.optIn()

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const snapshot = await readNativePushSubscriptionSnapshot()
    if (snapshot.subscriptionId || snapshot.permission === 'denied') return snapshot
    await new Promise((resolve) => window.setTimeout(resolve, 500))
  }
  return readNativePushSubscriptionSnapshot()
}

export const disableNativePushSubscription = async (): Promise<PushSubscriptionSnapshot> => {
  initializeNativeOneSignal()
  OneSignal.User.pushSubscription.optOut()
  return readNativePushSubscriptionSnapshot()
}

export const logoutNativeOneSignal = () => {
  initializeNativeOneSignal()
  OneSignal.InAppMessages.removeTrigger(NOTIFICATION_PERMISSION_PROMPT_TRIGGER)
  OneSignal.logout()
}

export const subscribeToNativeOneSignalChanges = (
  listener: () => void,
): (() => void) => {
  initializeNativeOneSignal()
  const handleSubscriptionChange = () => listener()
  const handlePermissionChange = () => listener()
  const handleNotificationClick = (event: NotificationClickEvent) => {
    const data = event.notification.additionalData as { clickAction?: unknown } | undefined
    const clickAction = typeof data?.clickAction === 'string' ? data.clickAction : ''
    if (clickAction.startsWith('/')) window.location.assign(clickAction)
  }

  OneSignal.User.pushSubscription.addEventListener('change', handleSubscriptionChange)
  OneSignal.Notifications.addEventListener('permissionChange', handlePermissionChange)
  OneSignal.Notifications.addEventListener('click', handleNotificationClick)

  return () => {
    OneSignal.User.pushSubscription.removeEventListener('change', handleSubscriptionChange)
    OneSignal.Notifications.removeEventListener('permissionChange', handlePermissionChange)
    OneSignal.Notifications.removeEventListener('click', handleNotificationClick)
  }
}
