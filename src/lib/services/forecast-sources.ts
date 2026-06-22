import { env } from '@/env'
import { createLogger } from '@/lib/logger'

const log = createLogger('forecast-sources')

/**
 * A publication that fed the Oracle for a forecast — one delivered article
 * (a news-indexer `forecast_match`), shown on the forecast page like a
 * forecaster with its own stance on the claim.
 */
export type ContributingSource = {
  url: string
  title: string | null
  source: string | null
  author: string | null
  publishedAt: string | null
  similarity: number | null
  /** [-1, 1] — negative favours NO, positive favours YES. */
  stance: number | null
  /** [0, 1] — how confident this source is. */
  certainty: number | null
  claim: string | null
  /** Oracle's per-article probability, 0–100. */
  oracleProbability: number | null
  /** YES | NO | ANNULLED once the forecast resolves, else null. */
  outcome: string | null
}

/**
 * The publications news-indexer recorded as contributing to a forecast's AI
 * estimate. Best-effort: returns [] when news-indexer is unconfigured or
 * unreachable — the panel is supplementary, never a reason to fail the page.
 */
export async function getContributingSources(forecastId: string): Promise<ContributingSource[]> {
  if (!env.NEWS_INDEXER_URL || !env.NEWS_INDEXER_API_KEY) return []

  try {
    const resp = await fetch(
      `${env.NEWS_INDEXER_URL}/forecast-sources/${encodeURIComponent(forecastId)}`,
      {
        headers: { 'x-api-key': env.NEWS_INDEXER_API_KEY },
        signal: AbortSignal.timeout(4000),
        next: { revalidate: 60 },
      },
    )
    if (!resp.ok) {
      log.warn({ forecastId, status: resp.status }, 'news-indexer forecast-sources non-OK')
      return []
    }
    return (await resp.json()) as ContributingSource[]
  } catch (err) {
    log.warn({ err, forecastId }, 'Failed to fetch contributing sources')
    return []
  }
}
