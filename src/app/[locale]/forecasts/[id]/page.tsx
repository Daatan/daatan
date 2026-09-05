import { Suspense } from 'react'
import { notFound, permanentRedirect } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import { getCachedPredictionTranslation } from '@/lib/services/translation'
import { getCanonicalSlugForAlias } from '@/lib/services/forecast'
import { buildForecastDescription, buildForecastKeywords } from '@/lib/forecast-seo'
import { isForecastViewableByVisitor } from '@/lib/forecast-visibility'
import { listComments } from '@/lib/services/comment'
import type { Comment } from '@/components/comments/CommentThread'
import { JsonLd } from '@/components/JsonLd'
import { getContextTimeline, getProbabilityHistory } from '@/lib/services/context'
import { getContributingSources } from '@/lib/services/forecast-sources'
import { getAppUrl } from '@/lib/branding'
import { getPanelSeries } from '@/lib/services/ai-panel-read'
import { communityProbability } from '@/lib/forecast-math'
import {
  forecastFaqJsonLd,
  latestProbabilityUpdateISO,
  type ForecastSeoCopy,
  type ForecastSeoLocale,
} from '@/lib/forecast-seo-schema'
import type { Snapshot as ContextSnapshot } from '@/components/forecasts/ContextTimeline'
import ForecastDetailClient from '@/app/forecasts/[id]/ForecastDetailClient'

export const revalidate = 60

const SSR_COMMENT_LIMIT = 50

async function getInitialComments(predictionId: string): Promise<Comment[]> {
  const { comments } = await listComments({ predictionId, page: 1, limit: SSR_COMMENT_LIMIT })
  return comments.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
  })) as Comment[]
}

async function getInitialContextSnapshots(predictionId: string): Promise<ContextSnapshot[]> {
  const data = await getContextTimeline(predictionId)
  if (!data) return []
  return data.contextSnapshots.map((s) => ({
    id: s.id,
    summary: s.summary,
    sources: (s.sources as ContextSnapshot['sources']) ?? [],
    createdAt: s.createdAt.toISOString(),
    externalProbability: s.externalProbability,
    externalReasoning: s.externalReasoning,
    oracleSnapshot: (s.oracleSnapshot as ContextSnapshot['oracleSnapshot']) ?? null,
  }))
}

interface Props {
  params: Promise<{ locale: string; id: string }>
}

async function getPrediction(idOrSlug: string) {
  const prediction = await prisma.prediction.findFirst({
    where: {
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
    },
    include: {
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          image: true,
          rs: true,
          role: true,
        },
      },
      newsAnchor: true,
      options: { orderBy: { displayOrder: 'asc' } },
      commitments: {
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, username: true, image: true } },
          option: { select: { id: true, text: true } },
        },
      },
      externalMarket: {
        include: {
          snapshots: {
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true, probability: true },
          },
        },
      },
      _count: { select: { commitments: true } },
    },
  })

  if (!prediction) return null

  const { outcomePayload, evidenceLinks } = prediction
  return {
    ...prediction,
    createdAt: prediction.createdAt.toISOString(),
    resolveByDatetime: prediction.resolveByDatetime.toISOString(),
    contextUpdatedAt: prediction.contextUpdatedAt?.toISOString(),
    publishedAt: prediction.publishedAt?.toISOString(),
    resolvedAt: prediction.resolvedAt?.toISOString(),
    lockedAt: prediction.lockedAt?.toISOString(),
    claimDeadline: prediction.claimDeadline?.toISOString() ?? null,
    outcomePayload:
      outcomePayload && typeof outcomePayload === 'object' && !Array.isArray(outcomePayload)
        ? outcomePayload
        : undefined,
    evidenceLinks: Array.isArray(evidenceLinks)
      ? evidenceLinks.filter((x): x is string => typeof x === 'string')
      : undefined,
    commitments: prediction.commitments.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
    externalMarket: prediction.externalMarket
      ? {
          provider: prediction.externalMarket.provider,
          slug: prediction.externalMarket.slug,
          url: prediction.externalMarket.url,
          question: prediction.externalMarket.question,
          outcomes: prediction.externalMarket.outcomes,
          resolved: prediction.externalMarket.resolved,
          snapshots: prediction.externalMarket.snapshots.map((s) => ({
            createdAt: s.createdAt.toISOString(),
            probability: s.probability,
          })),
        }
      : null,
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id: idOrSlug } = await params

  const prediction = await prisma.prediction.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: {
      id: true,
      claimText: true,
      detailsText: true,
      slug: true,
      isPublic: true,
      status: true,
      resolveByDatetime: true,
      tags: { select: { name: true } },
      _count: { select: { commitments: true } },
    },
  })

  if (!prediction) return { title: 'Forecast Not Found', robots: { index: false, follow: false } }

  const slug = prediction.slug || prediction.id
  const noIndexStatuses = ['DRAFT', 'PENDING_APPROVAL', 'VOID', 'UNRESOLVABLE']
  const shouldNoIndex = !prediction.isPublic || noIndexStatuses.includes(prediction.status)
  const baseCtx = {
    resolveByDatetime: prediction.resolveByDatetime,
    commitmentCount: prediction._count.commitments,
  }

  if (shouldNoIndex) {
    return {
      title: prediction.claimText,
      description: buildForecastDescription(prediction.claimText, prediction.detailsText, baseCtx),
      robots: { index: false, follow: false },
    }
  }

  const [translations, translatedLocales] = await Promise.all([
    getCachedPredictionTranslation(prediction.id, locale),
    prisma.predictionTranslation.findMany({
      where: { predictionId: prediction.id, language: { in: ['he', 'ru'] } },
      select: { language: true },
      distinct: ['language'],
    }),
  ])

  const translatedLangs = new Set(translatedLocales.map((t) => t.language))
  const hasTranslation = translatedLangs.has(locale)
  const title = translations.claimText || prediction.claimText
  const description = buildForecastDescription(
    title,
    translations.detailsText || prediction.detailsText,
    baseCtx,
  )

  const metaAppUrl = getAppUrl()

  return {
    title,
    description,
    // Entities come from the *English* claim (Hebrew has no case to lift them by);
    // tags and the locale generics carry the rest.
    keywords: buildForecastKeywords(prediction.claimText, prediction.tags, locale),
    ...(!hasTranslation ? { robots: { index: false, follow: false } } : {}),
    alternates: {
      canonical: `${metaAppUrl}/${locale}/forecasts/${slug}`,
      languages: {
        'x-default': `${metaAppUrl}/forecasts/${slug}`,
        en: `${metaAppUrl}/forecasts/${slug}`,
        ...(translatedLangs.has('he') ? { he: `${metaAppUrl}/he/forecasts/${slug}` } : {}),
        ...(translatedLangs.has('ru') ? { ru: `${metaAppUrl}/ru/forecasts/${slug}` } : {}),
      },
    },
    openGraph: {
      title,
      description,
      type: 'article',
      url: `${metaAppUrl}/${locale}/forecasts/${slug}`,
      locale,
    },
    twitter: {
      card: 'summary_large_image',
      site: '@daatan_dev',
      title,
      description,
    },
  }
}

function ForecastLoading() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
    </div>
  )
}

export default async function LocaleForecastDetailPage({ params }: Props) {
  const { locale, id: idOrSlug } = await params
  const prediction = await getPrediction(idOrSlug)

  if (!prediction) {
    // A retired slug 308-redirects to the current canonical slug (locale-prefixed).
    const canonical = await getCanonicalSlugForAlias(idOrSlug)
    if (canonical) permanentRedirect(`/${locale}/forecasts/${canonical}`)
    notFound()
  }

  const session = await auth()
  if (!isForecastViewableByVisitor(prediction, {
    userId: session?.user?.id,
    role: session?.user?.role,
  })) {
    notFound()
  }

  // VOID/UNRESOLVABLE with no participants have no history worth preserving.
  // Returning 404 prevents Google's "Soft 404" verdict (HTTP 200 + noindex + thin content).
  // Mirrors src/app/forecasts/[id]/page.tsx — this locale route was missing the same gate.
  if (
    (prediction.status === 'VOID' || prediction.status === 'UNRESOLVABLE') &&
    prediction._count.commitments === 0
  ) {
    notFound()
  }

  // The AI panel is a hidden, opt-in source (docs/LASSO.md §8), same gate as the
  // canonical /forecasts/[id] route: only load and pass its series when THIS viewer
  // enabled it in Settings. Read from the DB rather than the session token so the
  // toggle takes effect without re-login. Anonymous viewers never see it.
  const showAiPanel = session?.user?.id
    ? (await prisma.user.findUnique({ where: { id: session.user.id }, select: { showAiPanel: true } }))
        ?.showAiPanel ?? false
    : false

  const [initialComments, initialContextSnapshots, initialContributingSources, probabilityHistory, panelSeries] = await Promise.all([
    getInitialComments(prediction.id),
    getInitialContextSnapshots(prediction.id),
    getContributingSources(prediction.id),
    getProbabilityHistory(prediction.id),
    showAiPanel ? getPanelSeries(prediction.id) : Promise.resolve([]),
  ])
  // Chart series: includes kind='clock' glide requotes (unlike the event
  // timeline above) so the daily time-decay adjustment shows as movement.
  const initialProbabilityHistory = probabilityHistory.map((s) => ({
    id: s.id,
    createdAt: s.createdAt.toISOString(),
    externalProbability: s.externalProbability,
    kind: s.kind,
  }))
  const lastUpdatedISO = latestProbabilityUpdateISO(prediction.updatedAt, initialProbabilityHistory)

  // Apply cached translations — never triggers Gemini, read-only
  const translations = await getCachedPredictionTranslation(prediction.id, locale)
  const isLocalized = Object.keys(translations).length > 0
  const localizedPrediction = {
    ...prediction,
    claimText: translations.claimText || prediction.claimText,
    detailsText: translations.detailsText || prediction.detailsText,
    resolutionRules: translations.resolutionRules || prediction.resolutionRules,
  }

  const slug = prediction.slug || prediction.id
  const appUrl = getAppUrl()
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: localizedPrediction.claimText,
    description: localizedPrediction.detailsText || undefined,
    url: `${appUrl}/forecasts/${slug}`,
    image: `${appUrl}/forecasts/${slug}/opengraph-image`,
    datePublished: prediction.publishedAt,
    dateModified: prediction.updatedAt,
    author: {
      '@type': 'Person',
      name: prediction.author.name || prediction.author.username,
      url: `${appUrl}/profile/${prediction.author.username}`,
    },
    creator: {
      '@type': 'Person',
      name: prediction.author.name || prediction.author.username,
      url: `${appUrl}/profile/${prediction.author.username}`,
    },
    publisher: {
      '@type': 'Organization',
      name: 'DAATAN',
      alternateName: 'דעתן',
      url: appUrl,
      logo: { '@type': 'ImageObject', url: `${appUrl}/logo-icon.png` },
    },
  }

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${appUrl}/${locale}` },
      { '@type': 'ListItem', position: 2, name: 'Forecasts', item: `${appUrl}/${locale}/forecasts` },
      { '@type': 'ListItem', position: 3, name: localizedPrediction.claimText, item: `${appUrl}/${locale}/forecasts/${slug}` },
    ],
  }

  // Backfilled to match the canonical /forecasts/[id] route, which already has
  // these two — this locale route previously only had Article + Breadcrumb.
  const eventJsonLd = prediction.isPublic ? {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: localizedPrediction.claimText,
    description: localizedPrediction.detailsText || localizedPrediction.claimText,
    url: `${appUrl}/forecasts/${slug}`,
    image: `${appUrl}/forecasts/${slug}/opengraph-image`,
    startDate: prediction.publishedAt ?? prediction.createdAt,
    endDate: prediction.resolveByDatetime,
    eventStatus: prediction.status === 'VOID'
      ? 'https://schema.org/EventCancelled'
      : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    organizer: {
      '@type': 'Person',
      name: prediction.author.name || prediction.author.username,
      url: `${appUrl}/profile/${prediction.author.username}`,
    },
    performer: {
      '@type': 'Person',
      name: prediction.author.name || prediction.author.username,
      url: `${appUrl}/profile/${prediction.author.username}`,
    },
    location: {
      '@type': 'VirtualLocation',
      name: 'DAATAN',
      url: `${appUrl}/forecasts/${slug}`,
    },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${appUrl}/forecasts/${slug}`,
    },
  } : null

  const claimReviewJsonLd =
    prediction.isPublic &&
    prediction.resolvedAt &&
    (prediction.resolutionOutcome === 'correct' || prediction.resolutionOutcome === 'wrong')
      ? {
          '@context': 'https://schema.org',
          '@type': 'ClaimReview',
          url: `${appUrl}/forecasts/${slug}`,
          claimReviewed: localizedPrediction.claimText,
          datePublished: prediction.resolvedAt,
          author: {
            '@type': 'Organization',
            name: 'DAATAN',
            alternateName: 'דעתן',
            url: appUrl,
          },
          creator: {
            '@type': 'Organization',
            name: 'DAATAN',
            alternateName: 'דעתן',
            url: appUrl,
          },
          reviewRating: {
            '@type': 'Rating',
            ratingValue: prediction.resolutionOutcome === 'correct' ? 5 : 1,
            bestRating: 5,
            worstRating: 1,
            alternateName: prediction.resolutionOutcome === 'correct' ? 'Correct' : 'Wrong',
          },
          itemReviewed: {
            '@type': 'Claim',
            name: localizedPrediction.claimText,
            author: {
              '@type': 'Person',
              name: prediction.author.name || prediction.author.username,
              url: `${appUrl}/profile/${prediction.author.username}`,
            },
            creator: {
              '@type': 'Person',
              name: prediction.author.name || prediction.author.username,
              url: `${appUrl}/profile/${prediction.author.username}`,
            },
          },
        }
      : null

  // Question-form FAQPage (daatan#1295) — en/he/ru only, matching the existing
  // he/ru-only translation + sitemap scope; eo stays UI-only (no forecast schema).
  const seoLocale: ForecastSeoLocale | null =
    locale === 'he' || locale === 'ru' || locale === 'en' ? locale : null
  let faqJsonLd: object | null = null
  if (seoLocale && prediction.isPublic) {
    const t = await getTranslations({ locale, namespace: 'forecast' })
    const seoCopy: ForecastSeoCopy = {
      questionOpen: t('seoQuestionOpen'),
      questionResolved: t('seoQuestionResolved'),
      answerAiEstimate: t('seoAnswerAiEstimate'),
      answerCommunity: t('seoAnswerCommunity'),
      answerAsOf: t('seoAnswerAsOf'),
      answerResolvedYes: t('seoAnswerResolvedYes'),
      answerResolvedWrong: t('seoAnswerResolvedWrong'),
      answerNoEstimate: t('seoAnswerNoEstimate'),
      statusVoid: t('void'),
      statusUnresolvable: t('unresolvable'),
    }
    faqJsonLd = forecastFaqJsonLd(seoCopy, {
      locale: seoLocale,
      claim: localizedPrediction.claimText,
      status: prediction.status,
      aiProbability: prediction.outcomeType === 'BINARY' ? (prediction.confidence ?? null) : null,
      communityProbability:
        prediction.outcomeType === 'BINARY' ? communityProbability(prediction.commitments) : null,
      lastUpdatedISO,
    })
  }

  return (
    <>
      <JsonLd data={articleJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      {eventJsonLd && <JsonLd data={eventJsonLd} />}
      {claimReviewJsonLd && <JsonLd data={claimReviewJsonLd} />}
      {faqJsonLd && <JsonLd data={faqJsonLd} />}
      <Suspense fallback={<ForecastLoading />}>
        <ForecastDetailClient
          initialData={localizedPrediction}
          isLocalized={isLocalized}
          initialComments={initialComments}
          initialContextSnapshots={initialContextSnapshots}
          initialProbabilityHistory={initialProbabilityHistory}
          initialContributingSources={initialContributingSources}
          lastUpdatedISO={lastUpdatedISO}
          aiPanelSeries={panelSeries}
          showAiPanel={showAiPanel}
        />
      </Suspense>
    </>
  )
}
