'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { consentNotRequired } from '@/lib/consent-region'

const STORAGE_KEY = 'daatan_analytics_consent'
/** Set once the no-banner-region notice has been acknowledged; not a consent record. */
const NOTICE_KEY = 'daatan_analytics_notice_seen'
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
  if (value === 'denied') clearGaCookies()
}

/** GA keeps its cookies after consent is withdrawn; drop them so opting out is complete. */
function clearGaCookies() {
  const host = window.location.hostname
  const domains = ['', `; domain=${host}`, `; domain=.${host}`, `; domain=.${host.split('.').slice(-2).join('.')}`]
  for (const part of document.cookie.split(';')) {
    const name = part.split('=')[0].trim()
    if (!name.startsWith('_ga')) continue
    for (const d of domains) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${d}`
    }
  }
}

function noticeSeen(): boolean {
  try { return localStorage.getItem(NOTICE_KEY) !== null } catch { return false }
}

type Mode = 'banner' | 'notice'

/**
 * Analytics consent UI. Consent defaults to 'denied' (GoogleAnalytics.tsx).
 * - Stored choice: applied silently, nothing shown.
 * - No choice, region needs opt-in (EU/EEA/UK/CH, or the geo check failed):
 *   'banner' — Accept / Decline; nothing is collected until Accept.
 * - No choice, region needs no opt-in: the consent script has already granted
 *   analytics; 'notice' says so once, with an Opt out button. The implied grant
 *   is not stored, so it is re-checked on every visit.
 * - The footer "Cookie settings" link always opens the full banner.
 */
export default function CookieConsent() {
  const [mode, setMode] = useState<Mode | null>(null)
  const declineRef = useRef<HTMLButtonElement & HTMLAnchorElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const stored = getStoredConsent()
    if (stored !== null) {
      // Already decided — apply silently and do not show banner
      applyConsent(stored)
      return
    }
    let cancelled = false
    consentNotRequired().then((notRequired) => {
      if (cancelled || getStoredConsent() !== null) return
      if (notRequired && noticeSeen()) return
      previouslyFocused.current = document.activeElement as HTMLElement | null
      setMode(notRequired ? 'notice' : 'banner')
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    // Let the footer "Cookie settings" link re-open the banner so consent can be
    // withdrawn as easily as it was given.
    const reopen = () => {
      previouslyFocused.current = document.activeElement as HTMLElement | null
      setMode('banner')
    }
    window.addEventListener(COOKIE_SETTINGS_EVENT, reopen)
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, reopen)
  }, [])

  useEffect(() => {
    // Move focus into the banner so keyboard/screen-reader users notice it
    // immediately. Not a focus trap — the banner has no backdrop and doesn't
    // block the rest of the page, so trapping Tab here would hold keyboard
    // users hostage to a decision that mouse users can freely ignore.
    // Notice mode doesn't take focus: it asks for nothing, and a stray key
    // press shouldn't opt the visitor out.
    if (mode === 'banner') declineRef.current?.focus()
  }, [mode])

  const dismiss = () => {
    setMode(null)
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

  const handleNoticeOk = () => {
    try { localStorage.setItem(NOTICE_KEY, '1') } catch { /* ignore */ }
    dismiss()
  }

  if (!mode) return null
  const isNotice = mode === 'notice'

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape-to-dismiss listener on the region, catching bubbled keydowns from its content; the region itself isn't made interactive
    <div
      role="region"
      aria-label="Cookie consent"
      aria-describedby="cookie-consent-description"
      onKeyDown={(e) => { if (e.key === 'Escape') (isNotice ? handleNoticeOk : handleDecline)() }}
      className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-navy-700 border-t border-navy-600 shadow-lg"
    >
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <p id="cookie-consent-description" className="flex-1 text-sm text-gray-200">
          {isNotice
            ? 'We use Google Analytics cookies to understand how the app is used and improve it. You can opt out at any time.'
            : 'We use analytics cookies to understand how the app is used and improve it.'}{' '}
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
            {isNotice ? 'Opt out' : 'Decline'}
          </Button>
          <Button
            onClick={isNotice ? handleNoticeOk : handleAccept}
            size="sm"
          >
            {isNotice ? 'OK' : 'Accept'}
          </Button>
        </div>
      </div>
    </div>
  )
}
