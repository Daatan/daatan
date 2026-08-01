import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import type { Metadata } from 'next'
import FeedClient from './FeedClient'
import { JsonLd } from '@/components/JsonLd'
import { listForecasts, enrichPredictions } from '@/lib/services/forecast'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tags?: string; sortBy?: string }>
}): Promise<Metadata> {
  const params = await searchParams
  const hasCustomParams = params.status || params.tags || params.sortBy

  return {
    // Brand-neutral (no literal name) so the self-host edition inherits it; the
    // title already carries the brand. Kept long enough for Bing's meta-length check.
    description:
      'Prove you were right — without shouting into the void. A reputation-based platform to forecast the news, stake your credibility, and track your accuracy with Brier scores.',
    alternates: {
      canonical: 'https://daatan.com',
    },
    openGraph: {
      url: 'https://daatan.com',
    },
    // Filtered views skip SSR (see FeedPage below) and render client-side, so
    // Google sees an empty shell — don't let it index the query-param cross
    // product as separate pages. Mirrors the pattern in tags/[slug]/page.tsx.
    ...(hasCustomParams ? { robots: { index: false, follow: false } } : {}),
  }
}

function FeedLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
      <p className="text-gray-500 font-medium">Loading your feed...</p>
    </div>
  )
}

/**
 * Fetch the default ACTIVE feed server-side so crawlers see content on first
 * load. Calls the service layer directly (matches src/app/[locale]/page.tsx)
 * instead of a self-fetch through the API route.
 */
async function getInitialFeed() {
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
}

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tags?: string; sortBy?: string }>
}) {
  const params = await searchParams
  // Only SSR the default view (no filter params) — this is what crawlers hit.
  // Custom-filter URLs are less SEO-critical and the client handles them.
  const hasCustomParams = params.status || params.tags || params.sortBy
  const initialPredictions = hasCustomParams ? [] : await getInitialFeed()

  const websiteJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'DAATAN',
    alternateName: 'דעתן',
    url: 'https://daatan.com',
    description: 'Prove you were right — without shouting into the void.',
  }

  return (
    <>
      <JsonLd data={websiteJsonLd} />
      <Suspense fallback={<FeedLoading />}>
        <FeedClient initialPredictions={initialPredictions} />
      </Suspense>
    </>
  )
}
