import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { getLocale, getTranslations } from 'next-intl/server'
import { isSelfHosted } from '@/lib/edition'
import { listForesawEvents, type ForesawEventSummary } from '@/lib/services/retro-foresaw'
import { formatDay, percent } from './format'

async function getEvents(): Promise<ForesawEventSummary[]> {
  try {
    return await listForesawEvents()
  } catch {
    return []
  }
}

export async function generateMetadata(): Promise<Metadata> {
  await connection()
  const [t, events] = await Promise.all([getTranslations('whoForesaw.meta'), getEvents()])
  return {
    title: t('title'),
    description: t('description'),
    // An empty hub is thin content; it is indexed once it has an event (daatan#2217 Q3).
    ...(events.length === 0 ? { robots: { index: false, follow: true } } : {}),
    alternates: { canonical: '/who-foresaw' },
    openGraph: { url: '/who-foresaw', type: 'website' },
  }
}

/** Hub of "Who foresaw X?" event pages: the indexed entry point; event pages are noindex (daatan#2217 PR 3). */
export default async function WhoForesawPage() {
  await connection()
  if (isSelfHosted()) notFound()
  const [events, t, locale] = await Promise.all([getEvents(), getTranslations('whoForesaw'), getLocale()])

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl">
      <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">{t('title')}</h1>
      <p className="text-sm text-gray-400 mb-2">{t('subtitle')}</p>
      <p className="text-xs text-gray-500 mb-6 lg:mb-8">{t('method')}</p>
      {events.length === 0 ? (
        <p className="text-text-secondary">{t('empty')}</p>
      ) : (
        <ul className="space-y-3">
          {events.map((e) => (
            <li key={e.slug}>
              <Link
                href={`/who-foresaw/${e.slug}`}
                className="block rounded-lg border border-navy-600 bg-navy-700 p-4 hover:bg-navy-600 transition-colors"
              >
                <p dir="auto" className="text-white font-medium">{e.eventText}</p>
                <p className="mt-1 text-xs text-gray-400">
                  {t('eventDate', { date: formatDay(e.eventDate, locale) })}
                  {e.oraculProbability != null && <> · {t('oraculShort', { p: percent(e.oraculProbability) })}</>}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {t('counts', { called: e.called, against: e.against, total: e.total })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
