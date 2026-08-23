'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('PwaInstaller')

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

// Store a timestamp; re-prompt only after this many days
const DISMISS_KEY = 'pwa-install-dismissed-until'
const DISMISS_DAYS = 90

function isRunningAsStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari iOS sets navigator.standalone
    (window.navigator as unknown as Record<string, unknown>).standalone === true
  )
}

const PwaInstaller = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  const isDismissedRef = useRef(false)
  const isInstalledRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Already running as installed PWA — never show the banner
    if (isRunningAsStandalone()) {
      isInstalledRef.current = true
      setIsInstalled(true)
      return
    }

    try {
      const until = parseInt(localStorage.getItem(DISMISS_KEY) ?? '0', 10)
      if (Date.now() < until) {
        isDismissedRef.current = true
        setIsDismissed(true)
      }
    } catch {
      // localStorage unavailable — leave as not dismissed
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleBeforeInstallPrompt = (event: Event) => {
      if (isDismissedRef.current || isInstalledRef.current) return
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }

    const handleAppInstalled = () => {
      setDeferredPrompt(null)
      setIsInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

    navigator.serviceWorker.register('/sw.js').catch(error => {
      log.error({ err: error }, 'Service worker registration failed')
    })
  }, [])

  const handleInstallClick = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      setDeferredPrompt(null)
    }
  }

  const handleDismiss = () => {
    isDismissedRef.current = true
    setIsDismissed(true)
    try {
      const until = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000
      localStorage.setItem(DISMISS_KEY, String(until))
    } catch {
      // localStorage unavailable — dismiss for this session only
    }
  }

  if (isInstalled || !deferredPrompt || isDismissed) {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-300">
          Install DAATAN
        </div>
        <button
          onClick={handleDismiss}
          className="p-1 rounded-full text-text-secondary hover:text-white hover:bg-slate-800 transition-colors"
          aria-label="Close install prompt"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-xs text-slate-200 line-clamp-2">
          Install this app for quicker access and a better full-screen experience.
        </p>
        <button
          type="button"
          className="shrink-0 rounded-md bg-white px-3 py-1 text-xs font-semibold text-slate-900 shadow-sm hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          onClick={handleInstallClick}
        >
          Install
        </button>
      </div>
    </div>
  )
}

export default PwaInstaller
