'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { X, Bell } from 'lucide-react'
import { usePushSubscription } from '@/lib/hooks/usePushSubscription'

const DISMISS_KEY = 'push-prompt-dismissed'

const PushPermissionPrompt = () => {
  const { status } = useSession()
  const { isSupported, permission, isSubscribed, isLoading, subscribe } = usePushSubscription()
  const [show, setShow] = useState(false)
  const [isDismissed, setIsDismissed] = useState(true)

  // Check dismiss state on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time init from localStorage after mount; must stay out of SSR/hydration
      setIsDismissed(localStorage.getItem(DISMISS_KEY) === 'true')
    } catch {
      setIsDismissed(false)
    }
  }, [])

  // Listen for first-action event to show the prompt
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleFirstAction = () => {
      setShow(true)
    }

    window.addEventListener('daatan:first-action', handleFirstAction)
    return () => window.removeEventListener('daatan:first-action', handleFirstAction)
  }, [])

  const handleDismiss = () => {
    setIsDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, 'true')
    } catch {
      // localStorage unavailable
    }
  }

  const handleEnable = async () => {
    await subscribe()
    handleDismiss()
  }

  // Don't show if: not ready, not authenticated, not supported, already subscribed/denied/dismissed, or not triggered
  if (
    isLoading ||
    status !== 'authenticated' ||
    !isSupported ||
    permission !== 'default' ||
    isSubscribed ||
    isDismissed ||
    !show
  ) {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg max-w-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-300">
          <Bell className="w-4 h-4" />
          Push Notifications
        </div>
        <button
          onClick={handleDismiss}
          className="p-1 rounded-full text-text-secondary hover:text-white hover:bg-slate-800 transition-colors"
          aria-label="Close push notification prompt"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-xs text-slate-200 line-clamp-2">
          Get notified when someone commits to your forecasts or replies to your comments.
        </p>
        <button
          type="button"
          className="shrink-0 rounded-md bg-navy-700 px-3 py-1 text-xs font-semibold text-slate-900 shadow-sm hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          onClick={handleEnable}
        >
          Enable
        </button>
      </div>
    </div>
  )
}

export default PushPermissionPrompt
