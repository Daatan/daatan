/**
 * Oracul-backed news source for bots. An `oracle: <query>` entry in a bot's
 * newsSources runs the query through the Oracul's /search endpoint, which shares
 * the paid provider fallback chain (dataforseo → gdelt → ddg). Results carry
 * their real per-article publisher, so a single oracle query can surface a
 * multi-source hot topic.
 *
 * This is a paid path: each query is one Oracul search. The runner caps how many
 * are run per bot run (see MAX_ORACLE_SOURCES_PER_RUN) and only enabled when an
 * admin explicitly adds an `oracle:` entry — there is no default.
 */
import { parsePublishedAt, type RssItem } from './rss'
import { oracleSearch } from '@/lib/services/oracleSearch'
import { DEFAULT_MAX_ARTICLES } from '@/lib/services/oracle'
import type { OracleCallMeta } from '@/lib/services/oracleClient'
import { createLogger } from '@/lib/logger'

const log = createLogger('bot-oracle-source')

/** Max `oracle:` source queries processed per bot run (each is a paid search). */
export const MAX_ORACLE_SOURCES_PER_RUN = 3

/**
 * Runs each query through the Oracul's /search endpoint and maps the results to
 * RssItems. Results are bounded to the hot-topic window via `dateFrom` so the
 * Oracul only returns articles recent enough to form a hot topic. Failures on
 * individual queries are skipped (oracleSearch never throws and returns null
 * when the Oracul is unconfigured or empty).
 */
export async function fetchOracleSources(
  queries: string[],
  opts: { windowHours: number; meta: OracleCallMeta },
): Promise<RssItem[]> {
  if (queries.length === 0) return []

  const dateFrom = new Date(Date.now() - opts.windowHours * 60 * 60 * 1000)

  const settled = await Promise.allSettled(
    queries.map((q) => oracleSearch(q, DEFAULT_MAX_ARTICLES, { dateFrom }, opts.meta)),
  )

  const items: RssItem[] = []
  for (const result of settled) {
    if (result.status !== 'fulfilled' || !result.value) continue
    for (const r of result.value) {
      if (!r.title || !r.url) continue
      items.push({
        title: r.title.trim(),
        url: r.url,
        source: r.source || hostnameOrUrl(r.url),
        publishedAt: parsePublishedAt(r.publishedDate),
        snippet: r.snippet?.slice(0, 500),
      })
    }
  }

  log.info({ queryCount: queries.length, itemCount: items.length }, 'Fetched oracle sources')
  return items
}

function hostnameOrUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
