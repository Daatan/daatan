import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { getLocale, getTranslations } from 'next-intl/server'
import { isSelfHosted } from '@/lib/edition'
import { getForesawEvent, type ForesawArticle, type ForesawSide } from '@/lib/services/retro-foresaw'
import { formatDay, percent } from '../format'

interface Props {
  params: Promise<{ slug: string }>
}

const SECTIONS: { side: ForesawSide; tone: string }[] = [
  { side: 'called', tone: 'text-teal-400' },
  { side: 'against', tone: 'text-rose-400' },
  { side: 'neutral', tone: 'text-gray-400' },
]

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await connection()
  const { slug } = await params
  const event = isSelfHosted() ? null : await getForesawEvent(slug)
  if (!event) return { title: 'Not Found', robots: { index: false, follow: false } }
  const t = await getTranslations('whoForesaw')
  return {
    title: t('eventTitle', { event: event.eventText }),
    description: t('counts', { called: event.called, against: event.against, total: event.total }),
    // Event pages stay out of the index until there is data on them; the hub is indexed (daatan#2217 Q3).
    robots: { index: false, follow: true },
    alternates: { canonical: `/who-foresaw/${event.slug}` },
  }
}

function ArticleRow({ article, meta }: { article: ForesawArticle; meta: string }) {
  return (
    <li className="rounded-lg border border-navy-600 bg-navy-700 p-3">
      <a href={article.url} target="_blank" rel="noopener noreferrer nofollow" dir="auto" className="text-sm text-white hover:underline">
        {article.title || article.url}
      </a>
      <p className="mt-1 text-xs text-gray-400">{meta}</p>
    </li>
  )
}

export default async function WhoForesawEventPage({ params }: Props) {
  await connection()
  if (isSelfHosted()) notFound()
  const { slug } = await params
  const event = await getForesawEvent(slug)
  if (!event) notFound()
  const [t, locale] = await Promise.all([getTranslations('whoForesaw'), getLocale()])

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl">
      <Link href="/who-foresaw" className="text-sm text-blue-400 hover:underline">{t('back')}</Link>
      <h1 dir="auto" className="mt-3 text-2xl sm:text-3xl font-bold text-white">{event.eventText}</h1>
      <p className="mt-1 text-sm text-gray-400">
        {t('eventDate', { date: formatDay(event.eventDate, locale) })}
        {event.eventUrl && (
          <> · <a href={event.eventUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-400 hover:underline">{t('eventReport')}</a></>
        )}
      </p>

      <div className="mt-6 rounded-lg border border-navy-600 bg-navy-800 p-4">
        {event.oraculProbability != null && (
          <p className="text-white">
            {t('oraculLong', { date: formatDay(event.asOf, locale), p: percent(event.oraculProbability), count: event.total })}
          </p>
        )}
        <p dir="auto" className="mt-2 text-xs text-gray-400">{t('question', { claim: event.claimText })}</p>
        <p className="mt-2 text-xs text-gray-500">{event.hasWeights ? t('weightNote') : t('recencyNote')}</p>
      </div>

      {SECTIONS.map(({ side, tone }) => {
        const articles = event.articles.filter((a) => a.side === side)
        if (articles.length === 0) return null
        return (
          <section key={side} className="mt-8">
            <h2 className={`text-lg font-semibold ${tone}`}>{t(`sections.${side}`, { count: articles.length })}</h2>
            <ul className="mt-3 space-y-2">
              {articles.map((a) => (
                <ArticleRow
                  key={a.url}
                  article={a}
                  meta={[
                    a.outlet,
                    a.publishedDate && formatDay(a.publishedDate, locale),
                    t('stance', { value: a.stance.toFixed(2) }),
                    a.weightShare != null && t('weightShare', { share: percent(a.weightShare) }),
                  ].filter(Boolean).join(' · ')}
                />
              ))}
            </ul>
          </section>
        )
      })}

      {event.reports.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-white">{t('reports')}</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {event.reports.map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-400 hover:underline">
                  {r.outlet || r.url}
                </a>
                {r.publishedDate && <span className="text-gray-500"> · {formatDay(r.publishedDate, locale)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
