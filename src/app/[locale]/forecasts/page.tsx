import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { PredictionsPage } from '@/app/forecasts/PredictionsClient'
import { getFeedPage, isPageOutOfRange } from '@/app/forecasts/feed-page'
import PaginationLinks, { pageHref, parsePageParam } from '@/components/ui/PaginationLinks'
import { getAppUrl } from '@/lib/branding'


const META: Record<string, { title: string; description: string }> = {
  he: {
    title: 'תחזיות | DAATAN',
    description: 'עיין בתחזיות ועשה הימורים על אירועי עולם.',
  },
  ru: {
    title: 'Прогнозы | DAATAN',
    description: 'Просматривайте прогнозы и делайте ставки на мировые события.',
  },
  eo: {
    title: 'Prognozoj | DAATAN',
    description: 'Foliumu prognozojn kaj vetu pri mondaj eventoj.',
  },
}

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ page?: string | string[] }>
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params
  const page = parsePageParam((await searchParams).page)
  // he is the fallback, not eo/ru: it's the original supported locale, and
  // an unexpected locale value here means ALLOWED_LOCALES (layout.tsx) and
  // this map have drifted — he is the least-wrong default until that's fixed.
  const meta = META[locale] ?? META.he
  const appUrl = getAppUrl()
  // Self-canonical per page (daatan#2027); alternates point at the same page in each language.
  const path = (prefix: string) => `${appUrl}${pageHref(`${prefix}/forecasts`, page)}`

  return {
    title: page > 1 ? `${meta.title} — ${page}` : meta.title,
    description: meta.description,
    alternates: {
      canonical: path(`/${locale}`),
      languages: {
        'x-default': path(''),
        en: path(''),
        he: path('/he'),
        ru: path('/ru'),
      },
    },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: path(`/${locale}`),
    },
  }
}

export default async function LocaleForecastsPage({ params, searchParams }: Props) {
  const { locale } = await params
  const page = parsePageParam((await searchParams).page)
  const { predictions, totalPages } = await getFeedPage(page)
  if (isPageOutOfRange(page, totalPages)) notFound()

  const t = await getTranslations({ locale, namespace: 'forecastsFeed' })
  return (
    <PredictionsPage
      initialPredictions={predictions}
      pagination={
        <PaginationLinks
          base={`/${locale}/forecasts`}
          page={page}
          totalPages={totalPages}
          labels={{ previous: t('pagePrevious'), next: t('pageNext'), status: t('pageStatus', { page, total: totalPages }) }}
        />
      }
    />
  )
}
