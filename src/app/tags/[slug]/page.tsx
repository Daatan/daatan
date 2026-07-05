import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getTagBySlug, getVisibleTagPredictionCount } from '@/lib/services/tag'
import { listForecasts, enrichPredictions } from '@/lib/services/forecast'
import { getAppUrl } from '@/lib/branding'
import { JsonLd } from '@/components/JsonLd'
import TagFeed from './TagFeed'

export const revalidate = 60

const PAGE_LIMIT = 20

interface Props {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const tag = await getTagBySlug(slug)

  // Never had any predictions, or slug unknown — page body 404s either way.
  if (!tag || tag.count === 0) {
    return { title: 'Tag Not Found', robots: { index: false, follow: false } }
  }

  const total = await getVisibleTagPredictionCount(tag.id)
  const title = `${tag.name} forecasts | Daatan`
  const description = total > 0
    ? `Browse ${total} community forecast${total === 1 ? '' : 's'} tagged "${tag.name}" on Daatan.`
    : `Forecasts tagged "${tag.name}" on Daatan.`
  const url = `${getAppUrl()}/tags/${tag.slug}`

  return {
    title,
    description,
    // Tag has predictions overall but none currently visible — a transient
    // state, not a dead tag, so keep the URL alive but don't index it yet.
    ...(total === 0 ? { robots: { index: false, follow: false } } : {}),
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website' },
  }
}

export default async function TagPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { page: pageParam } = await searchParams
  const page = Math.max(1, Number(pageParam) || 1)

  const tag = await getTagBySlug(slug)

  // Tag doesn't exist, or has never had any predictions — 404 rather than an
  // empty shell page, to avoid an unbounded set of indexable-shaped empty URLs.
  if (!tag || tag.count === 0) notFound()

  const { predictions, total } = await listForecasts({
    where: { status: 'ACTIVE', isPublic: true, tags: { some: { id: tag.id } } },
    orderBy: { createdAt: 'desc' },
    page,
    limit: PAGE_LIMIT,
    isCuSort: false,
    sortOrder: 'desc',
  })
  const initialPredictions = enrichPredictions(predictions, undefined, {
    page,
    limit: PAGE_LIMIT,
    sortOrder: 'desc',
    isCuSort: false,
  })

  const url = `https://daatan.com/tags/${tag.slug}`
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://daatan.com' },
      { '@type': 'ListItem', position: 2, name: 'Forecasts', item: 'https://daatan.com/forecasts' },
      { '@type': 'ListItem', position: 3, name: tag.name, item: url },
    ],
  }

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <TagFeed tag={tag} predictions={initialPredictions} total={total} page={page} limit={PAGE_LIMIT} />
    </>
  )
}
