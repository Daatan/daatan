import { env } from '@/env'
import { createLogger } from '@/lib/logger'

const log = createLogger('news-indexer')

type LedgerOutcome = 'YES' | 'NO' | 'ANNULLED'

function toLedgerOutcome(outcome: string): LedgerOutcome {
  if (outcome === 'correct') return 'YES'
  if (outcome === 'wrong') return 'NO'
  return 'ANNULLED'  // void | unresolvable
}

/**
 * Notify news-indexer that a forecast resolved. The optional forecast-level
 * probabilities (0–1) let the crowd ('community') and our model ('oracle') join
 * the source reliability ELO ladder as players — see news-indexer worker/ratings.py.
 */
/**
 * Undo `/resolve` for a reverted resolution (daatan#2077). Fire-and-forget like the call it
 * undoes. A failure leaves the old outcome in the news-indexer ledgers, so it logs at error.
 */
export function notifyNewsIndexerUnresolve(forecastId: string): void {
  if (!env.NEWS_INDEXER_URL || !env.NEWS_INDEXER_API_KEY) return

  void fetch(`${env.NEWS_INDEXER_URL}/unresolve`, {
    method: 'POST',
    headers: {
      'x-api-key': env.NEWS_INDEXER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ forecastId }),
  })
    .then(async (res) => {
      if (!res.ok) {
        log.error({ forecastId, status: res.status }, 'news-indexer /unresolve refused')
        return
      }
      const body: { reverted: number; clampedSources: string[] } = await res.json()
      if (body.clampedSources.length > 0) {
        log.warn({ forecastId, clampedSources: body.clampedSources }, 'news-indexer /unresolve clamped sources')
      }
    })
    .catch((err: unknown) => {
      log.error({ forecastId, err }, 'news-indexer /unresolve call failed')
    })
}

export function notifyNewsIndexerResolution(
  forecastId: string,
  outcome: string,
  communityProbability?: number | null,
  aiProbability?: number | null,
): void {
  if (!env.NEWS_INDEXER_URL || !env.NEWS_INDEXER_API_KEY) return

  const ledgerOutcome = toLedgerOutcome(outcome)
  void fetch(`${env.NEWS_INDEXER_URL}/resolve`, {
    method: 'POST',
    headers: {
      'x-api-key': env.NEWS_INDEXER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      forecastId,
      outcome: ledgerOutcome,
      ...(communityProbability != null && { communityProbability }),
      ...(aiProbability != null && { aiProbability }),
    }),
  }).catch((err: unknown) => {
    log.warn({ err }, 'news-indexer /resolve call failed')
  })
}

/** One row of news-indexer `POST /search/before` (news-indexer#542). */
export interface NewsBeforeArticle {
  title: string
  url: string
  snippet: string | null
  source: string | null
  language: string | null
  /** YYYY-MM-DD */
  published_date: string
  /** ISO timestamp */
  published_at: string
  published_at_source: string | null
  indexed_at: string
  similarity: number
  /** Archived body, only with `includeText`; null when the archive has none. */
  text?: string | null
}

export interface SearchBeforeParams {
  q: string
  /** Exclusive bound on publication time. */
  before: Date
  /** Inclusive lower bound on publication time. */
  after?: Date
  /** Exclusive bound on ingest time: drops articles that only reached the index later. */
  indexedBefore?: Date
  limit: number
  minSimilarity: number
  includeText?: boolean
  timeoutMs?: number
}

/**
 * Semantic search over the whole news index, bounded to articles published before a date —
 * the evidence a retro simulation may use (daatan#2217). Unlike `/search` it has no
 * freshness window and no min-hits gate. Throws when news-indexer is unconfigured or refuses:
 * the caller has no fallback that keeps the "published before T0" guarantee.
 */
export async function searchNewsBefore(p: SearchBeforeParams): Promise<NewsBeforeArticle[]> {
  if (!env.NEWS_INDEXER_URL || !env.NEWS_INDEXER_API_KEY) throw new Error('news-indexer is not configured')
  const res = await fetch(`${env.NEWS_INDEXER_URL}/search/before`, {
    method: 'POST',
    headers: { 'x-api-key': env.NEWS_INDEXER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: p.q,
      before: p.before.toISOString(),
      ...(p.after ? { after: p.after.toISOString() } : {}),
      ...(p.indexedBefore ? { indexed_before: p.indexedBefore.toISOString() } : {}),
      limit: p.limit,
      min_similarity: p.minSimilarity,
      include_text: p.includeText ?? false,
    }),
    signal: AbortSignal.timeout(p.timeoutMs ?? 30_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`news-indexer /search/before ${res.status}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as NewsBeforeArticle[]
}
