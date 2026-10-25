import { unstable_cache } from 'next/cache'
import type { Prediction } from '@/components/forecasts/ForecastCard'
import { listForecasts, enrichPredictions } from '@/lib/services/forecast'

export const FEED_PAGE_SIZE = 20

// SSR feed is user-agnostic (no session forwarded), so it's safe to cache globally; `page` is
// an argument, so each ?page=N gets its own cache entry. 60s TTL keeps page 1 fresh.
const fetchFeedPage = unstable_cache(
  async (page: number): Promise<{ predictions: Prediction[]; total: number }> => {
    const query = { page, limit: FEED_PAGE_SIZE, isCuSort: false, sortOrder: 'desc' as const }
    const { predictions, total } = await listForecasts({
      ...query,
      where: { status: 'ACTIVE', isPublic: true },
      orderBy: { createdAt: 'desc' },
    })
    return { predictions: enrichPredictions(predictions, query), total }
  },
  ['forecasts-feed-page'],
  { revalidate: 60, tags: ['forecasts'] },
)

/**
 * One page of the public open-forecasts feed. On a DB error it is empty (the page still renders)
 * and claims to be the last page, so a transient failure neither 404s nor links onward.
 */
export async function getFeedPage(page: number): Promise<{ predictions: Prediction[]; total: number; totalPages: number }> {
  try {
    const { predictions, total } = await fetchFeedPage(page)
    return { predictions, total, totalPages: Math.ceil(total / FEED_PAGE_SIZE) }
  } catch {
    return { predictions: [], total: 0, totalPages: page }
  }
}

/** A ?page=N past the end would be an indexable-shaped empty URL — 404 it instead. */
export function isPageOutOfRange(page: number, totalPages: number): boolean {
  return page > 1 && page > totalPages
}
