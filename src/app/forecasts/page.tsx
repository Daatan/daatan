import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PredictionsPage } from './PredictionsClient'
import { JsonLd } from '@/components/JsonLd'
import PaginationLinks, { pageHref, parsePageParam } from '@/components/ui/PaginationLinks'
import { getAppUrl } from '@/lib/branding'
import { FEED_PAGE_SIZE, getFeedPage, isPageOutOfRange } from './feed-page'

interface Props {
  searchParams: Promise<{ page?: string | string[] }>
}

const TITLE = 'Forecasts — Browse Predictions'

// Each ?page=N is its own crawlable page with a self-canonical (daatan#2027); page 1 keeps the
// bare /forecasts canonical.
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const page = parsePageParam((await searchParams).page)
  const url = pageHref('/forecasts', page)
  return {
    title: page > 1 ? `${TITLE} — Page ${page}` : TITLE,
    description: 'Browse open and resolved predictions on DAATAN. Stake your reputation on geopolitics, economics, technology, and more. Track accuracy with Brier scores and ELO rankings.',
    alternates: { canonical: url },
    openGraph: { url, type: 'website' },
  }
}

export default async function ForecastsPage({ searchParams }: Props) {
  const page = parsePageParam((await searchParams).page)
  const { predictions, totalPages } = await getFeedPage(page)
  if (isPageOutOfRange(page, totalPages)) notFound()

  const t = await getTranslations('forecastsFeed')
  const itemListJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Forecasts on DAATAN',
    description: 'Open and resolved predictions tracked on DAATAN.',
    numberOfItems: predictions.length,
    itemListElement: predictions.map((p, i) => ({
      '@type': 'ListItem',
      position: (page - 1) * FEED_PAGE_SIZE + i + 1,
      url: `${getAppUrl()}/forecasts/${p.slug || p.id}`,
      name: p.claimText,
    })),
  }

  return (
    <>
      <JsonLd data={itemListJsonLd} />
      <PredictionsPage
        initialPredictions={predictions}
        pagination={
          <PaginationLinks
            base="/forecasts"
            page={page}
            totalPages={totalPages}
            labels={{ previous: t('pagePrevious'), next: t('pageNext'), status: t('pageStatus', { page, total: totalPages }) }}
          />
        }
      />
    </>
  )
}
