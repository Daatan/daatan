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
