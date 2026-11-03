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
