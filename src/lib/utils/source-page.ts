/** An article URL's host, lowercased and without `www.`; null when the URL doesn't parse. */
export function articleHost(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * The `/sources/[name]` path for an outlet (#2298): its resolved news-indexer outlet name when
 * there is one, otherwise the article's host. A bare host is enough because news-indexer's
 * `GET /outlets/{name}` resolves a domain to every feed on that host and never 404s, so an
 * outlet the indexer never saw (an article the Oracul found by web search) still has a page.
 * Returns null when there is neither a name nor a parseable URL.
 */
export function sourcePagePath(outletName: string | null | undefined, articleUrl?: string | null): string | null {
  const name = outletName?.trim() || articleHost(articleUrl)
  return name ? `/sources/${encodeURIComponent(name)}` : null
}
