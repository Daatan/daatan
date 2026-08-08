import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { PredictionsPage } from './PredictionsClient'
import type { Prediction } from '@/components/forecasts/ForecastCard'
import { listForecasts, enrichPredictions } from '@/lib/services/forecast'
import { JsonLd } from '@/components/JsonLd'
import { getAppUrl } from '@/lib/branding'

export const metadata: Metadata = {
  title: 'Forecasts — Browse Predictions',
  description: 'Browse open and resolved predictions on DAATAN. Stake your reputation on geopolitics, economics, technology, and more. Track accuracy with Brier scores and ELO rankings.',
  alternates: { canonical: '/forecasts' },
  openGraph: { url: '/forecasts', type: 'website' },
}

// Render on demand — at build time the DB is a placeholder. The data layer
// below is cached so crawler hits don't re-query the DB on every request.
export const dynamic = 'force-dynamic'

// SSR initial feed is user-agnostic (no session forwarded), so it's safe to
// cache globally. 60s TTL keeps the front page fresh for the bulk of traffic.
const fetchInitialFeed = unstable_cache(
  async (): Promise<Prediction[]> => {
    const { predictions } = await listForecasts({
      where: { status: 'ACTIVE', isPublic: true },
      orderBy: { createdAt: 'desc' },
      page: 1,
      limit: 20,
      isCuSort: false,
      sortOrder: 'desc',
    })
    return enrichPredictions(predictions, {
      page: 1,
      limit: 20,
      sortOrder: 'desc',
      isCuSort: false,
    })
  },
  ['forecasts-page-initial-feed'],
  { revalidate: 60, tags: ['forecasts'] },
)

async function getInitialFeed(): Promise<Prediction[]> {
  try {
    return await fetchInitialFeed()
  } catch {
    return []
  }
}

export default async function ForecastsPage() {
  const initialPredictions = await getInitialFeed()

  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Forecasts on DAATAN',
    description: 'Open and resolved predictions tracked on DAATAN.',
    numberOfItems: initialPredictions.length,
    itemListElement: initialPredictions.slice(0, 20).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${getAppUrl()}/forecasts/${p.slug || p.id}`,
      name: p.claimText,
    })),
  }

  return (
    <>
      <JsonLd data={itemListJsonLd} />
      <PredictionsPage initialPredictions={initialPredictions} />
    </>
  )
}
