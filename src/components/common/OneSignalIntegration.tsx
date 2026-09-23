import { useEffect, useRef } from 'react'
import { App as AntdApp } from 'antd'
import OneSignal from 'react-onesignal'
import { useAuthStore } from '../../store/modules/auth'

const ONESIGNAL_APP_ID = 'af46548f-181c-40e3-8880-0aae079c20a3'
const ONESIGNAL_WORKER_PATH = 'push/onesignal/OneSignalSDKWorker.js'
const ONESIGNAL_WORKER_SCOPE = '/push/onesignal/'

let initializationPromise: Promise<void> | null = null
let verificationDialogShown = false

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

const OneSignalIntegration = () => {
  const { modal } = AntdApp.useApp()
  const { user, loading } = useAuthStore()
  const registeredSubscriptionId = useRef<string | null>(null)

  useEffect(() => {
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
    if (loading) return

    void initializeOneSignal()
      .then(async () => {
        if (!user) {
          await OneSignal.logout()
          return
        }

        await OneSignal.login(user.id)
        OneSignal.User.setLanguage(getOneSignalLanguage(user.preferences?.locale))
        OneSignal.User.addTags({
          role: user.role,
          ...(user.storeId ? { store_id: user.storeId } : {}),
          ...(user.memberId ? { member_id: user.memberId } : {}),
        })
      })
      .catch((error) => {
        console.error('[OneSignal] Failed to synchronize user identity:', error)
      })
  }, [loading, user?.id, user?.memberId, user?.preferences?.locale, user?.role, user?.storeId])

  return null
}

export default OneSignalIntegration
