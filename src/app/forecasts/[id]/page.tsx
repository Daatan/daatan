import { notFound, permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import { buildForecastDescription } from '@/lib/forecast-seo'
import { isForecastViewableByVisitor } from '@/lib/forecast-visibility'
import { listComments } from '@/lib/services/comment'
import type { Comment } from '@/components/comments/CommentThread'
import { getContextTimeline, getProbabilityHistory } from '@/lib/services/context'
import { getPanelSeries } from '@/lib/services/ai-panel-read'
import { getForecastVoters } from '@/lib/services/forecast-sources'
import { getCanonicalSlugForAlias } from '@/lib/services/forecast'
import { communityProbability } from '@/lib/forecast-math'
import { forecastFaqJsonLd, latestProbabilityUpdateISO, type ForecastSeoCopy } from '@/lib/forecast-seo-schema'
import type { Snapshot as ContextSnapshot } from '@/components/forecasts/ContextTimeline'
import ForecastDetailClient from './ForecastDetailClient'
import { JsonLd } from '@/components/JsonLd'

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
    insufficientData: s.insufficientData,
  }))
}

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

interface Props {
  params: Promise<{ id: string }>
}

async function getPrediction(idOrSlug: string) {
  const prediction = await prisma.prediction.findFirst({
    where: {
      OR: [
        { id: idOrSlug },
        { slug: idOrSlug }
      ]
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
          twitterHandle: true,
        },
      },
      newsAnchor: true,
      tags: {
        select: { id: true, name: true, slug: true },
      },
      options: {
        orderBy: { displayOrder: 'asc' },
      },
      commitments: {
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, name: true, username: true, image: true },
          },
          option: {
            select: { id: true, text: true },
          },
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
      _count: {
        select: { commitments: true },
      },
    },
  })

  if (!prediction) return null

  // Format dates to ISO strings and normalize Json columns to the client view-model shape.
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
    commitments: prediction.commitments.map(c => ({
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
          snapshots: prediction.externalMarket.snapshots.map(s => ({
            createdAt: s.createdAt.toISOString(),
            probability: s.probability,
          })),
        }
      : null,
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id: idOrSlug } = await params
  const prediction = await prisma.prediction.findFirst({
    where: {
      OR: [
        { id: idOrSlug },
        { slug: idOrSlug }
      ]
    },
    select: {
      id: true,
      claimText: true,
      detailsText: true,
      slug: true,
      isPublic: true,
      status: true,
      resolveByDatetime: true,
      resolutionOutcome: true,
      resolvedAt: true,
      _count: { select: { commitments: true } },
    },
  })

  if (!prediction) {
    return {
      title: 'Forecast Not Found',
      robots: { index: false, follow: false },
    }
  }

  const slug = prediction.slug || prediction.id
  const noIndexStatuses = ['DRAFT', 'PENDING_APPROVAL', 'VOID', 'UNRESOLVABLE']
  const shouldNoIndex = !prediction.isPublic || noIndexStatuses.includes(prediction.status)
  const resolution =
    prediction.resolvedAt && prediction.resolutionOutcome
      ? { outcome: prediction.resolutionOutcome, resolvedAt: prediction.resolvedAt }
      : undefined
  const description = buildForecastDescription(prediction.claimText, prediction.detailsText, {
    resolveByDatetime: prediction.resolveByDatetime,
    commitmentCount: prediction._count.commitments,
    resolution,
  })

  if (shouldNoIndex) {
    return {
      title: prediction.claimText,
      description,
      robots: { index: false, follow: false },
    }
  }

  const translatedLocales = await prisma.predictionTranslation.findMany({
    where: { predictionId: prediction.id, language: { in: ['he', 'ru'] } },
    select: { language: true },
    distinct: ['language'],
  })
  const translatedLangs = new Set(translatedLocales.map((t) => t.language))

  return {
    title: prediction.claimText,
    description,
    alternates: {
      canonical: `https://daatan.com/forecasts/${slug}`,
      languages: {
        'x-default': `https://daatan.com/forecasts/${slug}`,
        en: `https://daatan.com/forecasts/${slug}`,
        ...(translatedLangs.has('he') ? { he: `https://daatan.com/he/forecasts/${slug}` } : {}),
        ...(translatedLangs.has('ru') ? { ru: `https://daatan.com/ru/forecasts/${slug}` } : {}),
      },
    },
    openGraph: {
      title: prediction.claimText,
      description,
      type: 'article',
      url: `https://daatan.com/forecasts/${slug}`,
    },
    twitter: {
      card: 'summary_large_image',
      site: '@daatan_dev',
      title: prediction.claimText,
      description,
    },
  }
}


export default async function ForecastDetailPage({ params }: Props) {
  const { id } = await params
  const prediction = await getPrediction(id)

  if (!prediction) {
    // A retired slug (e.g. fixed during English canonicalization) 308-redirects
    // to the current canonical slug instead of 404ing.
    const canonical = await getCanonicalSlugForAlias(id)
    if (canonical) permanentRedirect(`/forecasts/${canonical}`)
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
  // Forecasts that were active and have commitments stay reachable for participants.
  if (
    (prediction.status === 'VOID' || prediction.status === 'UNRESOLVABLE') &&
    prediction._count.commitments === 0
  ) {
    notFound()
  }

  // Canonicalize the URL: when reached by raw id, send the viewer to the
  // human-readable slug (matches the canonical/og URLs in generateMetadata).
  if (prediction.slug && id !== prediction.slug) {
    permanentRedirect(`/forecasts/${prediction.slug}`)
  }

  // The AI panel is a hidden, opt-in source (docs/LASSO.md §8): only load and pass its
  // series when THIS viewer enabled it in Settings. Read here rather than from the session
  // token so the toggle takes effect without re-login. Anonymous viewers never see it.
  const showAiPanel = session?.user?.id
    ? (await prisma.user.findUnique({ where: { id: session.user.id }, select: { showAiPanel: true } }))
        ?.showAiPanel ?? false
    : false

  const [initialComments, initialContextSnapshots, initialContributingSources, probabilityHistory, panelSeries] =
    await Promise.all([
      getInitialComments(prediction.id),
      getInitialContextSnapshots(prediction.id),
      getForecastVoters(prediction.id),
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
  const slug = prediction.slug || prediction.id
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: prediction.claimText,
    description: prediction.detailsText || undefined,
    url: `https://daatan.com/forecasts/${slug}`,
    image: `https://daatan.com/forecasts/${slug}/opengraph-image`,
    datePublished: prediction.publishedAt,
    dateModified: prediction.updatedAt,
    author: {
      '@type': 'Person',
      name: prediction.author.name || prediction.author.username,
      url: `https://daatan.com/profile/${prediction.author.username}`,
    },
    creator: {
      '@type': 'Person',
      name: prediction.author.name || prediction.author.username,
      url: `https://daatan.com/profile/${prediction.author.username}`,
    },
    publisher: {
      '@type': 'Organization',
      name: 'DAATAN',
      alternateName: 'דעתן',
      url: 'https://daatan.com',
      logo: { '@type': 'ImageObject', url: 'https://daatan.com/logo-icon.png' },
    },
  }

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://daatan.com' },
      { '@type': 'ListItem', position: 2, name: 'Forecasts', item: 'https://daatan.com/forecasts' },
      { '@type': 'ListItem', position: 3, name: prediction.claimText, item: `https://daatan.com/forecasts/${slug}` },
    ],
  }

  const eventJsonLd = prediction.isPublic ? {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: prediction.claimText,
    description: prediction.detailsText || prediction.claimText,
    url: `https://daatan.com/forecasts/${slug}`,
    image: `https://daatan.com/forecasts/${slug}/opengraph-image`,
    startDate: prediction.publishedAt ?? prediction.createdAt,
    endDate: prediction.resolveByDatetime,
    eventStatus: prediction.status === 'VOID'
      ? 'https://schema.org/EventCancelled'
      : 'https://schema.org/EventScheduled',
    // Without an online attendance mode Google assumes a physical event and
    // rejects VirtualLocation ("Invalid object type for field location").
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    organizer: {
      '@type': 'Person',
      name: prediction.author.name || prediction.author.username,
      url: `https://daatan.com/profile/${prediction.author.username}`,
    },
    performer: {
      '@type': 'Person',
      name: prediction.author.name || prediction.author.username,
      url: `https://daatan.com/profile/${prediction.author.username}`,
    },
    location: {
      '@type': 'VirtualLocation',
      name: 'DAATAN',
      url: `https://daatan.com/forecasts/${slug}`,
    },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `https://daatan.com/forecasts/${slug}`,
    },
  } : null

  const claimReviewJsonLd =
    prediction.isPublic &&
    prediction.resolvedAt &&
    (prediction.resolutionOutcome === 'correct' || prediction.resolutionOutcome === 'wrong')
      ? {
          '@context': 'https://schema.org',
          '@type': 'ClaimReview',
          url: `https://daatan.com/forecasts/${slug}`,
          claimReviewed: prediction.claimText,
          datePublished: prediction.resolvedAt,
          author: {
            '@type': 'Organization',
            name: 'DAATAN',
            alternateName: 'דעתן',
            url: 'https://daatan.com',
          },
          creator: {
            '@type': 'Organization',
            name: 'DAATAN',
            alternateName: 'דעתן',
            url: 'https://daatan.com',
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
            name: prediction.claimText,
            author: {
              '@type': 'Person',
              name: prediction.author.name || prediction.author.username,
              url: `https://daatan.com/profile/${prediction.author.username}`,
            },
            creator: {
              '@type': 'Person',
              name: prediction.author.name || prediction.author.username,
              url: `https://daatan.com/profile/${prediction.author.username}`,
            },
          },
        }
      : null

  const t = await getTranslations('forecast')
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
  const faqJsonLd = prediction.isPublic
    ? forecastFaqJsonLd(seoCopy, {
        locale: 'en',
        claim: prediction.claimText,
        status: prediction.status,
        aiProbability: prediction.outcomeType === 'BINARY' ? (prediction.confidence ?? null) : null,
        communityProbability:
          prediction.outcomeType === 'BINARY' ? communityProbability(prediction.commitments) : null,
        lastUpdatedISO,
      })
    : null

  return (
    <>
      <JsonLd data={articleJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      {eventJsonLd && <JsonLd data={eventJsonLd} />}
      {claimReviewJsonLd && <JsonLd data={claimReviewJsonLd} />}
      {faqJsonLd && <JsonLd data={faqJsonLd} />}
      <ForecastDetailClient
        initialData={prediction}
        initialComments={initialComments}
        initialContextSnapshots={initialContextSnapshots}
        initialProbabilityHistory={initialProbabilityHistory}
        initialContributingSources={initialContributingSources}
        lastUpdatedISO={lastUpdatedISO}
        aiPanelSeries={panelSeries}
        showAiPanel={showAiPanel}
      />
    </>
  )
}
