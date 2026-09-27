import { useEffect } from 'react'
import { auth } from '../../config/firebase'
import { useAuthStore } from '../../store/modules/auth'
import { getPushDeviceId, readPushSubscriptionSnapshot } from '../../services/oneSignal'

const NotificationOpenTracker = () => {
  const loading = useAuthStore((state) => state.loading)

  useEffect(() => {
    const handleWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK' && typeof event.data.action === 'string') {
        window.location.assign(event.data.action)
      }
    }
    navigator.serviceWorker?.addEventListener('message', handleWorkerMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', handleWorkerMessage)
  }, [])

  useEffect(() => {
    if (loading) return
    const url = new URL(window.location.href)
    const deliveryId = url.searchParams.get('notificationDelivery')
    if (!deliveryId) return

    const recordOpen = async () => {
      const idToken = await auth.currentUser?.getIdToken()
      const snapshot = readPushSubscriptionSnapshot()
      const response = await fetch('/.netlify/functions/track-notification-open', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          deliveryId,
          deviceId: getPushDeviceId(),
          subscriptionId: snapshot.subscriptionId,
        }),
      })
      if (!response.ok) return
      url.searchParams.delete('notificationDelivery')
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    }

    void recordOpen().catch((error) => {
      console.warn('[NotificationOpenTracker] Unable to record notification open:', error)
    })
  }, [loading])

  return null
}

export default NotificationOpenTracker
