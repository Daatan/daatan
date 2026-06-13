import Parser from 'rss-parser'
import { createLogger } from '@/lib/logger'
import { isPrivateIP } from '@/lib/utils/scraper'

const log = createLogger('rss')

// `<source url="...">Publisher</source>` is emitted per-item by Google News
// search feeds but is not one of rss-parser's default item fields, so we map it
// explicitly. With attributes present rss-parser yields { _: 'Publisher', $: {...} };
// without attributes it yields the bare string.
type SourceTag = { _?: string } | string | undefined
const parser: Parser<unknown, { sourceTag?: SourceTag }> = new Parser({
  timeout: 10000,
  headers: { 'User-Agent': 'Daatan-Bot/1.0' },
  customFields: { item: [['source', 'sourceTag']] },
})

export interface RssItem {
  title: string
  url: string
  source: string       // Per-article publisher when known, else the feed name/domain
  publishedAt: Date
  snippet?: string
}

/**
 * Fetches items from a list of RSS feed URLs.
 * Failures on individual feeds are logged and skipped.
 */
export async function fetchRssFeeds(feedUrls: string[]): Promise<RssItem[]> {
  const results = await Promise.allSettled(feedUrls.map(fetchFeed))
  const items: RssItem[] = []

  for (const result of results) {
    if (result.status === 'fulfilled') {
      items.push(...result.value)
    }
  }

  return items
}

/** Returns true if the hostname string looks like a private/internal address. */
function isPrivateHostname(hostname: string): boolean {
  // Direct IP literals
  if (isPrivateIP(hostname)) return true
  // Loopback names
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return true
  // Internal TLDs
  if (hostname.endsWith('.internal') || hostname.endsWith('.local')) return true
  return false
}

/** Reads the per-article publisher from a mapped `<source>` element, if present. */
function publisherFromSourceTag(sourceTag: SourceTag): string | undefined {
  if (!sourceTag) return undefined
  const name = typeof sourceTag === 'string' ? sourceTag : sourceTag._
  return name?.trim() || undefined
}

async function fetchFeed(url: string): Promise<RssItem[]> {
  try {
    let targetUrl = url.trim()

    // Support "Search: [query]" syntax using Google News RSS
    if (targetUrl.toLowerCase().startsWith('search:')) {
      const query = targetUrl.slice(7).trim()
      targetUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`
    }

    // SSRF protection: only allow HTTPS URLs and block private/internal hostnames
    let parsedUrl: URL
    try {
      parsedUrl = new URL(targetUrl)
    } catch {
      log.warn({ url: targetUrl }, 'Invalid RSS feed URL, skipping')
      return []
    }
    if (parsedUrl.protocol !== 'https:') {
      log.warn({ url: targetUrl, protocol: parsedUrl.protocol }, 'Non-HTTPS RSS feed URL rejected')
      return []
    }
    if (isPrivateHostname(parsedUrl.hostname)) {
      log.warn({ url: targetUrl, hostname: parsedUrl.hostname }, 'Private/internal RSS feed hostname rejected')
      return []
    }

    // Google News aggregates many publishers behind one feed, so the real source
    // is per-item (the <source> element, or the " - Publisher" title suffix) —
    // not the feed title. For ordinary single-publisher feeds the feed title is
    // the correct source, so we only apply the per-item logic for Google News.
    const isGoogleNews = parsedUrl.hostname === 'news.google.com'

    const feed = await parser.parseURL(targetUrl)
    const feedSource = feed.title || parsedUrl.hostname

    const items = (feed.items ?? [])
      .filter((item) => item.title && item.link)
      .map((item) => {
        let title = item.title!.trim()
        const publisher = publisherFromSourceTag(item.sourceTag)
        let source = publisher || feedSource

        if (isGoogleNews) {
          // Google News appends " - Publisher" to every headline. Strip it for
          // cleaner clustering, and use it as the source when no <source> element
          // gave us one.
          const idx = title.lastIndexOf(' - ')
          if (idx > 0) {
            if (!publisher) {
              source = title.slice(idx + 3).trim() || source
            }
            title = title.slice(0, idx).trim()
          }
        }

        return {
          title,
          url: item.link!,
          source,
          publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          snippet: item.contentSnippet?.slice(0, 500),
        }
      })
      .slice(0, 30)

    log.info({ url: targetUrl, itemCount: items.length }, 'Fetched feed successfully')
    return items
  } catch (err) {
    log.warn({ err, url }, 'Failed to fetch news source')
    return []
  }
}

/**
 * Detects "hot" topics — titles that appear across multiple sources
 * within a given time window.
 *
 * Returns groups of related items (same cluster = similar topic).
 */
export interface HotTopic {
  /** Representative title from the earliest item in the cluster */
  title: string
  /** All items that mention this topic */
  items: RssItem[]
  /** Number of distinct sources */
  sourceCount: number
}

/**
 * Clusters recent items by title-keyword overlap and returns clusters that span
 * at least `minSources` distinct sources within the last `windowHours`.
 *
 * Two items are treated as the same story when their titles share ≥2 keywords.
 * A cluster is the transitive closure of that relation (union-find over an
 * inverted keyword index), so the result is independent of feed arrival order.
 */
export function detectHotTopics(
  items: RssItem[],
  minSources: number,
  windowHours: number,
): HotTopic[] {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000)
  const recent = items.filter((item) => item.publishedAt >= cutoff)
  if (recent.length === 0) return []

  const keywordSets = recent.map((item) => extractKeywords(item.title))

  // Inverted index: keyword → indices of items whose title contains it.
  const index = new Map<string, number[]>()
  keywordSets.forEach((keywords, i) => {
    for (const kw of keywords) {
      const list = index.get(kw)
      if (list) list.push(i)
      else index.set(kw, [i])
    }
  })

  // Union-find over items. We only ever inspect pairs that share ≥1 keyword
  // (via the inverted index) and union those sharing ≥2.
  const parent = recent.map((_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }

  const sharedCount = new Map<number, number>() // packed pair key → shared keyword count
  for (const list of index.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const key = list[a] * recent.length + list[b]
        const next = (sharedCount.get(key) ?? 0) + 1
        sharedCount.set(key, next)
        if (next === 2) union(list[a], list[b])
      }
    }
  }

  // Group items by their union-find root, preserving original order within each
  // group so the representative title is the earliest item in the cluster.
  const clusters = new Map<number, RssItem[]>()
  recent.forEach((item, i) => {
    const root = find(i)
    const group = clusters.get(root)
    if (group) group.push(item)
    else clusters.set(root, [item])
  })

  const topics: HotTopic[] = []
  for (const clusterItems of clusters.values()) {
    const distinctSources = new Set(clusterItems.map((i) => i.source)).size
    if (distinctSources >= minSources) {
      topics.push({
        title: clusterItems[0].title,
        items: clusterItems,
        sourceCount: distinctSources,
      })
    }
  }

  return topics.sort((a, b) => b.sourceCount - a.sourceCount)
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or',
  'but', 'is', 'are', 'was', 'were', 'has', 'have', 'had', 'will', 'be',
  'with', 'as', 'by', 'from', 'that', 'this', 'it', 'he', 'she', 'they',
  'we', 'you', 'i', 'its', 'not', 'no', 'up', 'out', 'after', 'over',
])

/**
 * Extracts significant keywords from a title. Stop words are removed but short
 * tokens are kept (≥2 chars), so load-bearing acronyms like "AI", "EU", "oil"
 * survive clustering instead of being discarded by a length filter.
 */
function extractKeywords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
    .slice(0, 8)
}
