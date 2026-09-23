import { useEffect } from 'react'
import OneSignal from 'react-onesignal'
import { useAuthStore } from '../../store/modules/auth'
import { usePushNotificationStore } from '../../store/modules/pushNotifications'
import { normalizePhoneNumber } from '../../utils/phoneNormalization'
import {
  getDeviceTags,
  getOneSignalLanguage,
  initializeOneSignal,
  isOneSignalOrigin,
  readPushSubscriptionSnapshot,
  subscribeToOneSignalChanges,
  syncPushSubscriptionToFirestore,
} from '../../services/oneSignal'

const OneSignalIntegration = () => {
  const { user, loading } = useAuthStore()
  const setSnapshot = usePushNotificationStore((state) => state.setSnapshot)

  useEffect(() => {
    if (loading) return

    if (!isOneSignalOrigin()) {
      setSnapshot({
        status: 'unsupported',
        permission: 'default',
        optedIn: false,
        subscriptionId: null,
        supported: false,
      })
      return
    }

    let active = true
    let unsubscribe: (() => void) | undefined

    const publishSnapshot = async () => {
      if (!active) return
      const snapshot = readPushSubscriptionSnapshot()
      setSnapshot(snapshot)
      if (user) {
        try {
          await syncPushSubscriptionToFirestore(user, snapshot)
        } catch (error) {
          console.error('[OneSignal] Failed to synchronize subscription status:', error)
        }
      }
    }

    setSnapshot({
      status: 'loading',
      permission: 'default',
      optedIn: false,
      subscriptionId: null,
      supported: true,
    })

    void initializeOneSignal()
      .then(async () => {
        if (!active) return

        if (!user) {
          await OneSignal.logout()
          await publishSnapshot()
          return
        }

        await OneSignal.login(user.id)
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

        if (!deviceTags.os) OneSignal.User.removeTag('os')
        if (!deviceTags.browser) OneSignal.User.removeTag('browser')

        if (user.preferences?.notifications === false && OneSignal.User.PushSubscription.optedIn) {
          await OneSignal.User.PushSubscription.optOut()
        }

        unsubscribe = subscribeToOneSignalChanges(() => {
          void publishSnapshot()
        })
        await publishSnapshot()
      })
      .catch((error) => {
        console.error('[OneSignal] Failed to initialize:', error)
        if (!active) return
        setSnapshot({
          status: 'error',
          permission: 'default',
          optedIn: false,
          subscriptionId: null,
          supported: true,
          error: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [
    loading,
    setSnapshot,
    user?.displayName,
    user?.email,
    user?.id,
    user?.memberId,
    user?.phone,
    user?.preferences?.locale,
    user?.preferences?.notifications,
    user?.profile?.phone,
    user?.role,
  ])

  return null
}

export default OneSignalIntegration
