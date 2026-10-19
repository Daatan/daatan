'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'

const STORAGE_KEY = 'daatan_analytics_consent'
/** Dispatched on window by the footer "Cookie settings" link to re-open the banner. */
export const COOKIE_SETTINGS_EVENT = 'daatan:open-cookie-settings'

type ConsentValue = 'granted' | 'denied'

function getStoredConsent(): ConsentValue | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'granted' || v === 'denied') return v
  } catch {
    // localStorage unavailable (SSR, private mode)
  }
  return null
}

function applyConsent(value: ConsentValue) {
  if (typeof window === 'undefined') return
  // Ensure dataLayer and gtag exist before calling — the GA script may not have
  // loaded yet when this runs (both are afterInteractive). Defining them here
  // queues the consent update so gtag will process it when it initializes.
  window.dataLayer = window.dataLayer || []
  if (typeof window.gtag !== 'function') {
    // Define a minimal gtag that queues commands in dataLayer (same pattern as GA).
    // The real gtag will pick up and process the queued items when it loads.
    window.gtag = (...args: unknown[]) => window.dataLayer!.push(args)
  }
  window.gtag('consent', 'update', {
    analytics_storage: value,
    ad_storage: 'denied', // we never use ads
  })
}

/**
 * Shows a minimal GDPR/CCPA consent banner on first visit.
 * - Sets gtag consent to 'denied' by default (done in GoogleAnalytics.tsx).
 * - On accept: updates consent to 'granted' and persists to localStorage.
 * - On decline: persists 'denied', banner disappears.
 * - On subsequent visits: reads from localStorage and applies silently.
 */
export default function CookieConsent() {
  const [visible, setVisible] = useState(false)
  const declineRef = useRef<HTMLButtonElement & HTMLAnchorElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const stored = getStoredConsent()
    if (stored !== null) {
      // Already decided — apply silently and do not show banner
      applyConsent(stored)
      return
    }
    previouslyFocused.current = document.activeElement as HTMLElement | null
    setVisible(true)
  }, [])

  useEffect(() => {
    // Let the footer "Cookie settings" link re-open the banner so consent can be
    // withdrawn as easily as it was given.
    const reopen = () => {
      previouslyFocused.current = document.activeElement as HTMLElement | null
      setVisible(true)
    }
    window.addEventListener(COOKIE_SETTINGS_EVENT, reopen)
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, reopen)
  }, [])

  useEffect(() => {
    // Move focus into the banner so keyboard/screen-reader users notice it
    // immediately. Not a focus trap — the banner has no backdrop and doesn't
    // block the rest of the page, so trapping Tab here would hold keyboard
    // users hostage to a decision that mouse users can freely ignore.
    if (visible) declineRef.current?.focus()
  }, [visible])

  const dismiss = () => {
    setVisible(false)
    // Return focus to wherever the user was, but only if that element is
    // still attached — a route change while the banner was up could have
    // unmounted it.
    if (previouslyFocused.current && document.body.contains(previouslyFocused.current)) {
      previouslyFocused.current.focus()
    }
  }

  const handleAccept = () => {
    try { localStorage.setItem(STORAGE_KEY, 'granted') } catch { /* ignore */ }
    applyConsent('granted')
    dismiss()
  }

  const handleDecline = () => {
    try { localStorage.setItem(STORAGE_KEY, 'denied') } catch { /* ignore */ }
    // Also revokes a previously granted choice when re-opened from the footer.
    applyConsent('denied')
    dismiss()
  }

  if (!visible) return null

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape-to-dismiss listener on the region, catching bubbled keydowns from its content; the region itself isn't made interactive
    <div
      role="region"
      aria-label="Cookie consent"
      aria-describedby="cookie-consent-description"
      onKeyDown={(e) => { if (e.key === 'Escape') handleDecline() }}
      className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-navy-700 border-t border-navy-600 shadow-lg"
    >
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <p id="cookie-consent-description" className="flex-1 text-sm text-gray-200">
          We use analytics cookies to understand how the app is used and improve it.
          No ads. No cross-site tracking.{' '}
          <Link href="/privacy" className="underline hover:text-white">Privacy Policy</Link>.
        </p>
        <div className="flex gap-2 shrink-0">
          <Button
            ref={declineRef}
            onClick={handleDecline}
            variant="outline"
            size="sm"
          >
            Decline
          </Button>
          <Button
            onClick={handleAccept}
            size="sm"
          >
            Accept
          </Button>
        </div>
      </div>
    </div>
  )
}
