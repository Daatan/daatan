import { notFound, permanentRedirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import { buildForecastDescription, buildForecastKeywords, publicDetailsText } from '@/lib/forecast-seo'
import { isForecastViewableByVisitor } from '@/lib/forecast-visibility'
import { getCanonicalSlugForAlias } from '@/lib/services/forecast'
import { communityProbability } from '@/lib/forecast-math'
import { forecastFaqJsonLd, type ForecastSeoCopy } from '@/lib/forecast-seo-schema'
import ForecastDetailClient from './ForecastDetailClient'
import { getForecastDetail, loadForecastDetailProps } from './_forecast/detail-data'
import RelatedForecasts from '@/components/forecasts/RelatedForecasts'
import { JsonLd } from '@/components/JsonLd'
import { getAppName, getAppUrl } from '@/lib/branding'
import { authorJsonLd } from '@/lib/author-json-ld'
import { ogLocale } from '@/lib/og-locale'

interface Props {
  params: Promise<{ id: string }>
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
      tags: { select: { name: true } },
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
  const metaAppUrl = getAppUrl()

  return {
    // `absolute`: this route does not inherit the root `%s | DAATAN` template, so the bare claim
    // was the whole <title> (he/ru pages already carry the brand). OG/Twitter keep the claim alone.
    title: { absolute: `${prediction.claimText} | ${getAppName()}` },
    description,
    keywords: buildForecastKeywords(prediction.claimText, prediction.tags, 'en'),
    alternates: {
      canonical: `${metaAppUrl}/forecasts/${slug}`,
      languages: {
        'x-default': `${metaAppUrl}/forecasts/${slug}`,
        en: `${metaAppUrl}/forecasts/${slug}`,
        ...(translatedLangs.has('he') ? { he: `${metaAppUrl}/he/forecasts/${slug}` } : {}),
        ...(translatedLangs.has('ru') ? { ru: `${metaAppUrl}/ru/forecasts/${slug}` } : {}),
      },
    },
    openGraph: {
      title: prediction.claimText,
      description,
      type: 'article',
      url: `${metaAppUrl}/forecasts/${slug}`,
      siteName: getAppName(),
      locale: ogLocale('en'),
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
  const prediction = await getForecastDetail(id)

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

  const detailProps = await loadForecastDetailProps(prediction, session?.user)
  const { lastUpdatedISO } = detailProps
  const slug = prediction.slug || prediction.id
  const appUrl = getAppUrl()
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: prediction.claimText,
    description: publicDetailsText(prediction.detailsText) || undefined,
    url: `${appUrl}/forecasts/${slug}`,
    image: `${appUrl}/forecasts/${slug}/opengraph-image`,
    datePublished: prediction.publishedAt,
    dateModified: prediction.updatedAt,
    author: authorJsonLd(prediction.author, appUrl),
    creator: authorJsonLd(prediction.author, appUrl),
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
      { '@type': 'ListItem', position: 1, name: 'Home', item: appUrl },
      { '@type': 'ListItem', position: 2, name: 'Forecasts', item: `${appUrl}/forecasts` },
      { '@type': 'ListItem', position: 3, name: prediction.claimText, item: `${appUrl}/forecasts/${slug}` },
    ],
  }

  const eventJsonLd = prediction.isPublic ? {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: prediction.claimText,
    description: publicDetailsText(prediction.detailsText) || prediction.claimText,
    url: `${appUrl}/forecasts/${slug}`,
    image: `${appUrl}/forecasts/${slug}/opengraph-image`,
    startDate: prediction.publishedAt ?? prediction.createdAt,
    endDate: prediction.resolveByDatetime,
    eventStatus: prediction.status === 'VOID'
      ? 'https://schema.org/EventCancelled'
      : 'https://schema.org/EventScheduled',
    // Without an online attendance mode Google assumes a physical event and
    // rejects VirtualLocation ("Invalid object type for field location").
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    organizer: authorJsonLd(prediction.author, appUrl),
    performer: authorJsonLd(prediction.author, appUrl),
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
          claimReviewed: prediction.claimText,
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
            name: prediction.claimText,
            author: authorJsonLd(prediction.author, appUrl),
            creator: authorJsonLd(prediction.author, appUrl),
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
      <ForecastDetailClient initialData={prediction} {...detailProps} />
      {prediction.isPublic && <RelatedForecasts predictionId={prediction.id} linkLocale="en" />}
    </>
  )
}
