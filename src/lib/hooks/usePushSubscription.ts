'use client'

import { useState, useEffect, useCallback } from 'react'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function usePushSubscription() {
  const [isSupported, setIsSupported] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bootstraps from browser capability checks + service-worker readiness (external systems)
    setIsSupported(supported)

    if (!supported) {
      setIsLoading(false)
      return
    }

    setPermission(Notification.permission)

    // Check existing subscription
    navigator.serviceWorker.ready.then((registration) => {
      registration.pushManager.getSubscription().then((sub) => {
        setIsSubscribed(!!sub)
        setIsLoading(false)
      })
    }).catch(() => {
      setIsLoading(false)
    })
  }, [])

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false

    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapidKey) return false

    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') return false

      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      } as PushSubscriptionOptionsInit)

      const json = subscription.toJSON()
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: {
            p256dh: json.keys?.p256dh,
            auth: json.keys?.auth,
          },
        }),
      })

      if (res.ok) {
        setIsSubscribed(true)
        return true
      }
      return false
    } catch {
      return false
    }
  }, [isSupported])

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!isSupported) return false

    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (!subscription) {
        setIsSubscribed(false)
        return true
      }

      const endpoint = subscription.endpoint
      await subscription.unsubscribe()

      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      })

      setIsSubscribed(false)
      return true
    } catch {
      return false
    }
  }, [isSupported])

  return { isSupported, permission, isSubscribed, isLoading, subscribe, unsubscribe }
}
