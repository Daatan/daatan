import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import type { Metadata } from 'next'
import FeedClient from '@/app/FeedClient'
import { listForecasts, enrichPredictions } from '@/lib/services/forecast'

export const dynamic = 'force-dynamic'

const META: Record<string, { title: string; description: string }> = {
  he: {
    title: 'DAATAN - שוק תחזיות',
    description:
      'הוכח שצדקת — בלי לצעוק לחלל. פלטפורמת תחזיות מבוססת מוניטין: חזה את החדשות, הַמֵּר על האמינות שלך ועקוב אחר רמת הדיוק שלך עם ציוני בְּרַייֶר בטבלת המובילים.',
  },
  ru: {
    title: 'DAATAN - Рынок прогнозов',
    description:
      'Докажи, что был прав — без крика в пустоту. Репутационная платформа прогнозов: предсказывай новости, ставь на свою репутацию и отслеживай точность прогнозов.',
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
      canonical: `https://daatan.com/${locale}`,
      languages: {
        'x-default': 'https://daatan.com',
        en: 'https://daatan.com',
        he: 'https://daatan.com/he',
        ru: 'https://daatan.com/ru',
      },
    },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: `https://daatan.com/${locale}`,
      locale,
    },
  }
}

function FeedLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
    </div>
  )
}

export default async function LocaleHomePage() {
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

  return (
    <Suspense fallback={<FeedLoading />}>
      <FeedClient initialPredictions={initialPredictions} />
    </Suspense>
  )
}
