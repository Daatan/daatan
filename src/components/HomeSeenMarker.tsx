'use client'

import { useEffect } from 'react'
import { HOME_SEEN_COOKIE, HOME_SEEN_MAX_AGE } from '@/lib/first-visit'

/**
 * Remembers that the visitor was shown the home-v5 page, so the site root shows the feed instead of
 * it next time (#1840). Set client-side on purpose: an effect only runs when the page
 * is actually displayed, never for a link prefetch.
 */
export function HomeSeenMarker() {
  useEffect(() => {
    try {
      const secure = window.location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `${HOME_SEEN_COOKIE}=1; Path=/; Max-Age=${HOME_SEEN_MAX_AGE}; SameSite=Lax${secure}`
    } catch {
      // Cookies blocked: the visitor simply keeps seeing home-v5 at the root.
    }
  }, [])
  return null
}
