'use client'

import { useState, useEffect, useCallback } from 'react'

/** Window event fired when notifications are marked read elsewhere (e.g. the list page). */
export const UNREAD_COUNT_CHANGED_EVENT = 'daatan:unread-count-changed'

/** Notify every `useUnreadCount` subscriber (sidebar badge) that the count changed. */
export function notifyUnreadCountChanged(count?: number) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(UNREAD_COUNT_CHANGED_EVENT, { detail: { count } }))
}

export function useUnreadCount() {
  const [count, setCount] = useState(0)

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/unread-count')
      if (res.ok) {
        const data = await res.json()
        setCount(data.count)
      }
    } catch {
      // Silently fail — badge is non-critical
    }
  }, [])

  useEffect(() => {
    fetchCount()

    // Poll every 30s while tab is visible
    let interval: ReturnType<typeof setInterval> | null = null

    const startPolling = () => {
      if (!interval) {
        interval = setInterval(fetchCount, 30_000)
      }
    }

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval)
        interval = null
      }
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopPolling()
      } else {
        fetchCount()
        startPolling()
      }
    }

    // Instant update when another component marks notifications read
    const handleChanged = (e: Event) => {
      const next = (e as CustomEvent<{ count?: number }>).detail?.count
      if (typeof next === 'number') setCount(next)
      else fetchCount()
    }

    startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener(UNREAD_COUNT_CHANGED_EVENT, handleChanged)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener(UNREAD_COUNT_CHANGED_EVENT, handleChanged)
    }
  }, [fetchCount])

  return { count, refetch: fetchCount }
}
