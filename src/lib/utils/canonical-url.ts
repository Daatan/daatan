const _TRACKING = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', 'source', 'via'])

/**
 * Canonical dedup key for an article URL, mirroring news-indexer's `normalize_url`
 * (lowercase scheme+host, strip `www.`, drop tracking params + fragment) so the two
 * source streams dedup against the same key. Falls back to the raw URL if unparseable.
 * Pure — safe to import from client components.
 */
export function canonicalKey(url: string): string {
  try {
    const u = new URL(url)
    u.protocol = u.protocol.toLowerCase()
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) {
      if (_TRACKING.has(k)) u.searchParams.delete(k)
    }
    return u.toString()
  } catch {
    return url
  }
}
