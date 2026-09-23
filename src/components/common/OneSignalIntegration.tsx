import { useEffect, useRef } from 'react'
import { App as AntdApp } from 'antd'
import OneSignal from 'react-onesignal'
import { useAuthStore } from '../../store/modules/auth'
import { normalizePhoneNumber } from '../../utils/phoneNormalization'

const ONESIGNAL_APP_ID = 'af46548f-181c-40e3-8880-0aae079c20a3'
const ONESIGNAL_WORKER_PATH = 'push/onesignal/OneSignalSDKWorker.js'
const ONESIGNAL_WORKER_SCOPE = '/push/onesignal/'
const ONESIGNAL_SITE_ORIGIN = 'https://macanudosocials.com'

let initializationPromise: Promise<void> | null = null
let verificationDialogShown = false

const isOneSignalOrigin = () =>
  typeof window !== 'undefined' && window.location.origin === ONESIGNAL_SITE_ORIGIN

const initializeOneSignal = (): Promise<void> => {
  if (!initializationPromise) {
    OneSignal.Debug.setLogLevel(import.meta.env.DEV ? 'warn' : 'error')
    const promise = OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      allowLocalhostAsSecureOrigin: import.meta.env.DEV,
      serviceWorkerPath: ONESIGNAL_WORKER_PATH,
      serviceWorkerParam: { scope: ONESIGNAL_WORKER_SCOPE },
    }).catch((error: unknown) => {
      initializationPromise = null
      throw error
    })

    initializationPromise = promise
    return promise
  }

  return initializationPromise
}

const getOneSignalLanguage = (locale?: string): string =>
  locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'

type DeviceType = 'mobile' | 'tablet' | 'desktop'
type OperatingSystem = 'ios' | 'android' | 'windows' | 'macos' | 'linux'
type Browser = 'safari' | 'chrome' | 'edge' | 'firefox'

const getDeviceTags = (): {
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

const OneSignalIntegration = () => {
  const { modal } = AntdApp.useApp()
  const { user, loading } = useAuthStore()
  const registeredSubscriptionId = useRef<string | null>(null)

  useEffect(() => {
    if (!isOneSignalOrigin()) return

    let active = true
    let observerAttached = false

    const reportRegistration = () => {
      const subscriptionId = OneSignal.User.PushSubscription.id
      if (subscriptionId && subscriptionId !== registeredSubscriptionId.current) {
        registeredSubscriptionId.current = subscriptionId
        console.info('[OneSignal] Push subscription registered:', subscriptionId)
      }
    }

    void initializeOneSignal()
      .then(() => {
        if (!active) return

        OneSignal.User.PushSubscription.addEventListener('change', reportRegistration)
        observerAttached = true
        reportRegistration()

        if (!verificationDialogShown) {
          verificationDialogShown = true
          modal.info({
            title: 'Your OneSignal SDK integration is complete!',
            content: 'You can now send Push Notifications & In-App Messages through OneSignal. Tap below to enable push notifications.',
            okText: 'Got it',
            closable: false,
            maskClosable: false,
            onOk: async () => {
              await OneSignal.Notifications.requestPermission()
              reportRegistration()
            },
          })
        }
      })
      .catch((error) => {
        console.error('[OneSignal] Failed to initialize:', error)
      })

    return () => {
      active = false
      if (observerAttached) {
        OneSignal.User.PushSubscription.removeEventListener('change', reportRegistration)
      }
    }
  }, [modal])

  useEffect(() => {
    if (loading || !isOneSignalOrigin()) return

    void initializeOneSignal()
      .then(async () => {
        if (!user) {
          await OneSignal.logout()
          return
        }

        await OneSignal.login(user.id)
        const email = user.email?.trim().toLowerCase()
        const phone = normalizePhoneNumber(user.phone || user.profile?.phone || '')
        const deviceTags = getDeviceTags()
        OneSignal.User.setLanguage(getOneSignalLanguage(user.preferences?.locale))

        if (email) {
          OneSignal.User.addEmail(email)
        }
        if (phone) {
          OneSignal.User.addSms(phone)
        }

        // The free plan allows six data tags per user. Email and phone belong to
        // channel subscriptions, so keep the six tags focused on segmentation.
        OneSignal.User.removeTags(['store_id', 'phone'])
        OneSignal.User.addTags({
          role: user.role,
          name: user.displayName || email?.split('@')[0] || user.id,
          device: deviceTags.device,
          ...(deviceTags.os ? { os: deviceTags.os } : {}),
          ...(deviceTags.browser ? { browser: deviceTags.browser } : {}),
          ...(user.memberId ? { member_id: user.memberId } : {}),
        })

        if (!deviceTags.os) {
          OneSignal.User.removeTag('os')
        }
        if (!deviceTags.browser) {
          OneSignal.User.removeTag('browser')
        }
      })
      .catch((error) => {
        console.error('[OneSignal] Failed to synchronize user identity:', error)
      })
  }, [
    loading,
    user?.displayName,
    user?.email,
    user?.id,
    user?.memberId,
    user?.phone,
    user?.preferences?.locale,
    user?.profile?.phone,
    user?.role,
  ])

  return null
}

export default OneSignalIntegration
