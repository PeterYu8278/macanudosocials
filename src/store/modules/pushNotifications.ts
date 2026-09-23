import { create } from 'zustand'

export type PushSubscriptionStatus =
  | 'idle'
  | 'loading'
  | 'prompt'
  | 'subscribed'
  | 'unsubscribed'
  | 'denied'
  | 'unsupported'
  | 'error'

export interface PushSubscriptionSnapshot {
  status: PushSubscriptionStatus
  permission: NotificationPermission
  optedIn: boolean
  subscriptionId: string | null
  supported: boolean
  error?: string
}

interface PushNotificationState extends PushSubscriptionSnapshot {
  busy: boolean
  setSnapshot: (snapshot: PushSubscriptionSnapshot) => void
  setBusy: (busy: boolean) => void
}

export const EMPTY_PUSH_SUBSCRIPTION: PushSubscriptionSnapshot = {
  status: 'idle',
  permission: 'default',
  optedIn: false,
  subscriptionId: null,
  supported: false,
}

export const usePushNotificationStore = create<PushNotificationState>((set) => ({
  ...EMPTY_PUSH_SUBSCRIPTION,
  busy: false,
  setSnapshot: (snapshot) => set(snapshot),
  setBusy: (busy) => set({ busy }),
}))
