import { Suspense } from 'react'
import { notFound, permanentRedirect } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/auth'
import { getCachedPredictionTranslation } from '@/lib/services/translation'
import { getCanonicalSlugForAlias } from '@/lib/services/forecast'
import { buildForecastDescription, buildForecastKeywords, publicDetailsText } from '@/lib/forecast-seo'
import { ogLocale } from '@/lib/og-locale'
import { isForecastViewableByVisitor } from '@/lib/forecast-visibility'
import { JsonLd } from '@/components/JsonLd'
import { getAppName, getAppUrl } from '@/lib/branding'
import { authorJsonLd } from '@/lib/author-json-ld'
import { communityProbability } from '@/lib/forecast-math'
import {
  forecastFaqJsonLd,
  type ForecastSeoCopy,
  type ForecastSeoLocale,
} from '@/lib/forecast-seo-schema'
import ForecastDetailClient from '@/app/forecasts/[id]/ForecastDetailClient'
import { getForecastDetail, loadForecastDetailProps } from '@/app/forecasts/[id]/_forecast/detail-data'
import RelatedForecasts from '@/components/forecasts/RelatedForecasts'


interface Props {
  params: Promise<{ locale: string; id: string }>
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
  // No ctx here: its extras ("3 forecasters have committed", en-US dates) are English.
  const description = buildForecastDescription(
    title,
    publicDetailsText(prediction.detailsText, translations.detailsText),
  )

  const metaAppUrl = getAppUrl()

  return {
    title,
    description,
    // Translated claim first (Cyrillic has case, so RU pages lead with Russian
    // names — Yandex is why the tag exists), English claim second as the fallback
    // Hebrew needs (no case to lift entities by). Tags + locale generics fill in.
    keywords: buildForecastKeywords([title, prediction.claimText], prediction.tags, locale),
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
      siteName: getAppName(),
      locale: ogLocale(locale),
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
  const prediction = await getForecastDetail(idOrSlug)

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

  const detailProps = await loadForecastDetailProps(prediction, session?.user)
  const { lastUpdatedISO } = detailProps

  // Apply cached translations — never triggers Gemini, read-only
  const translations = await getCachedPredictionTranslation(prediction.id, locale)
  // Localized only when every shown field has a current translation (#1827); a partial set
  // (one field stale after an edit) lets the client's /translate call fill the gap.
  const isLocalized = (['claimText', 'detailsText', 'resolutionRules'] as const)
    .filter((f) => !!prediction[f])
    .every((f) => !!translations[f])
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
    description: publicDetailsText(prediction.detailsText, translations.detailsText) || undefined,
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
    description: publicDetailsText(prediction.detailsText, translations.detailsText) || localizedPrediction.claimText,
    url: `${appUrl}/forecasts/${slug}`,
    image: `${appUrl}/forecasts/${slug}/opengraph-image`,
    startDate: prediction.publishedAt ?? prediction.createdAt,
    endDate: prediction.resolveByDatetime,
    eventStatus: prediction.status === 'VOID'
      ? 'https://schema.org/EventCancelled'
      : 'https://schema.org/EventScheduled',
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
            author: authorJsonLd(prediction.author, appUrl),
            creator: authorJsonLd(prediction.author, appUrl),
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
        <ForecastDetailClient initialData={localizedPrediction} isLocalized={isLocalized} {...detailProps} />
      </Suspense>
      {prediction.isPublic && <RelatedForecasts predictionId={prediction.id} linkLocale={locale} uiLocale={locale} />}
    </>
  )
}
