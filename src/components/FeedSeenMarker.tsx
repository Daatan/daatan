'use client'

import { useEffect } from 'react'
import { FEED_SEEN_COOKIE, FEED_SEEN_MAX_AGE } from '@/lib/first-visit'

/**
 * Remembers that the visitor opened the forecasts page, so the site root shows the feed instead of
 * the home-v5 intro next time (#1840). Set client-side on purpose: an effect only runs when the page
 * is actually displayed, never for a link prefetch.
 */
export function FeedSeenMarker() {
  useEffect(() => {
    try {
      const secure = window.location.protocol === 'https:' ? '; Secure' : ''
      document.cookie = `${FEED_SEEN_COOKIE}=1; Path=/; Max-Age=${FEED_SEEN_MAX_AGE}; SameSite=Lax${secure}`
    } catch {
      // Cookies blocked: the visitor simply keeps seeing the intro at the root.
    }
  }, [])
  return null
}
