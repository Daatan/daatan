import type { Metadata } from 'next'
import { PredictionsPage } from '@/app/forecasts/PredictionsClient'
import { listForecasts, enrichPredictions } from '@/lib/services/forecast'

export const dynamic = 'force-dynamic'

const META: Record<string, { title: string; description: string }> = {
  he: {
    title: 'תחזיות | DAATAN',
    description: 'עיין בתחזיות ועשה הימורים על אירועי עולם.',
  },
  ru: {
    title: 'Прогнозы | DAATAN',
    description: 'Просматривайте прогнозы и делайте ставки на мировые события.',
  },
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const meta = META[locale] ?? META.he

  return {
    title: meta.title,
    description: meta.description,
    alternates: {
      canonical: `https://daatan.com/${locale}/forecasts`,
      languages: {
        'x-default': 'https://daatan.com/forecasts',
        en: 'https://daatan.com/forecasts',
        he: 'https://daatan.com/he/forecasts',
        ru: 'https://daatan.com/ru/forecasts',
      },
    },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: `https://daatan.com/${locale}/forecasts`,
    },
  }
}

export default async function LocaleForecastsPage() {
  const { predictions } = await listForecasts({
    where: { status: 'ACTIVE', isPublic: true },
    orderBy: { createdAt: 'desc' },
    page: 1,
    limit: 20,
    isCuSort: false,
    sortOrder: 'desc',
  })
  const initialPredictions = enrichPredictions(predictions, {
    page: 1,
    limit: 20,
    sortOrder: 'desc',
    isCuSort: false,
  })

  return <PredictionsPage initialPredictions={initialPredictions} />
}
