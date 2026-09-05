import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import type { Metadata } from 'next'
import FeedClient from '@/app/FeedClient'
import { listForecasts, enrichPredictions } from '@/lib/services/forecast'
import { getAppUrl } from '@/lib/branding'
import { globalKeywords } from '@/lib/forecast-seo'

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
  eo: {
    title: 'DAATAN - Prognoza Merkato',
    description:
      'Pruvu, ke vi pravis — sen krii en la malplenon. Reputaci-bazita platformo por prognozi novaĵojn, veti vian kredindecon kaj spuri vian precizecon per Brier-Poentaroj.',
  },
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  // he is the fallback, not eo/ru: it's the original supported locale, and
  // an unexpected locale value here means ALLOWED_LOCALES (layout.tsx) and
  // this map have drifted — he is the least-wrong default until that's fixed.
  const meta = META[locale] ?? META.he
  const appUrl = getAppUrl()

  return {
    title: meta.title,
    description: meta.description,
    keywords: globalKeywords(locale),
    alternates: {
      canonical: `${appUrl}/${locale}`,
      languages: {
        'x-default': appUrl,
        en: appUrl,
        he: `${appUrl}/he`,
        ru: `${appUrl}/ru`,
      },
    },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: `${appUrl}/${locale}`,
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
