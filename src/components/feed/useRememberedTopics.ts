'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { STANDARD_TAGS } from '@/lib/constants'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('useRememberedTopics')

// The remembered topic filter (daatan#2203), shared by both feeds since daatan#2330: guests keep
// it in localStorage, signed-in users on their account (/api/user/preferences). Written only on
// an explicit pick/clear, never from a ?tags= URL, so opening a shared link doesn't overwrite
// someone's saved topics.
export const FEED_TAGS_STORAGE_KEY = 'daatan_feed_tags'

function knownTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  return tags.filter((t): t is string => typeof t === 'string' && (STANDARD_TAGS as readonly string[]).includes(t))
}

function readGuestTags(): string[] {
  try {
    return knownTags(JSON.parse(localStorage.getItem(FEED_TAGS_STORAGE_KEY) ?? '[]'))
  } catch {
    return []
  }
}

function saveRememberedTags(tags: string[], signedIn: boolean) {
  if (signedIn) {
    fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedTags: tags }),
    }).catch((err) => log.warn({ err }, 'Failed to save feed tags'))
    return
  }
  try {
    localStorage.setItem(FEED_TAGS_STORAGE_KEY, JSON.stringify(tags))
  } catch {
    // Storage unavailable (private mode, blocked site data): the filter just isn't remembered.
  }
}

/**
 * The selected topics. `urlTags` (from ?tags=) wins; when the URL names none, the remembered
 * choice is restored once after mount, as soon as the session is known. A pick made while the
 * account fetch is in flight wins over the restore. `choose` sets and remembers a new selection.
 */
export function useRememberedTopics(urlTags: string[] | null): [string[], (tags: string[]) => void] {
  const { status } = useSession()
  const [selected, setSelected] = useState<string[]>(urlTags ?? [])
  const restoreStarted = useRef(false)
  const userChanged = useRef(false)
  const urlHasTags = urlTags != null

  useEffect(() => {
    if (restoreStarted.current || urlHasTags || status === 'loading') return
    restoreStarted.current = true
    const apply = (tags: string[]) => {
      if (userChanged.current || tags.length === 0) return
      setSelected(tags)
    }
    if (status === 'authenticated') {
      fetch('/api/user/preferences', { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => apply(knownTags(data?.feedTags)))
        .catch((err) => log.warn({ err }, 'Failed to load feed tags'))
    } else {
      // Browser-only: localStorage is unreadable during SSR, hence an effect.
      apply(readGuestTags())
    }
  }, [urlHasTags, status])

  const choose = useCallback((tags: string[]) => {
    userChanged.current = true
    setSelected(tags)
    saveRememberedTags(tags, status === 'authenticated')
  }, [status])

  return [selected, choose]
}
