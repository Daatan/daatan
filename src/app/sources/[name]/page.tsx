import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { ExternalLink, Newspaper } from 'lucide-react'
import { getPublicOutletDetail } from '@/lib/services/outlets'
import { localizedText, telegramHref } from '@/lib/utils/outlet-identity'
import { getOutletForecastRows, getPublicForecastLinks } from '@/lib/services/outlet-forecasts'
import { groupPublications } from '@/lib/utils/group-publications'
import { sortOutletForecasts } from '@/lib/utils/outlet-forecasts'
import { brierGrade } from '@/lib/utils/brier-grade'
import { authorsOfOutlet, canonicalOutlet, getSourceLeaderboard } from '@/lib/services/sourceLeaderboard'
import { SOURCE_LEADERBOARD_MIN_PREDICTIONS } from '@/lib/services/leaderboard-cached'
import { getTopicBoards, outletTopicRecords } from '@/lib/services/sourceTopicBoards'
import TopicBreakdown from '@/components/sources/TopicBreakdown'
import OutletForecastTable from '@/components/sources/OutletForecastTable'
import { ShowMoreList, ShowMoreTable } from '@/components/sources/ShowMore'
import { brierTone } from '@/components/leaderboard/LeaderboardParts'
import { getAppUrl } from '@/lib/branding'
import DeskBadge from '@/components/sources/DeskBadge'


interface Props {
  params: Promise<{ name: string }>
}

/** Below this many resolved predictions a skill/Brier number is mostly noise. */
const LOW_SAMPLE = 30
const INITIAL_PUBLICATIONS = 10
const INITIAL_AUTHORS = 10

const OUTCOME_LABEL: Record<string, string> = { YES: 'outcomeYes', NO: 'outcomeNo', ANNULLED: 'outcomeAnnulled' }

function isUrl(s: string | null | undefined): s is string {
  return !!s && /^https?:\/\//.test(s)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params
  const detail = await getPublicOutletDetail(decodeURIComponent(name))
  if (!detail) return { title: 'Source Not Found', robots: { index: false, follow: false } }

  const locale = await getLocale()
  const shown = localizedText(detail.displayName, locale) ?? detail.name
  const title = `${shown} — source profile | Daatan`
  const description =
    localizedText(detail.description, locale) ?? `Track record, publications, and identity info for ${shown} on Daatan.`
  const url = `${getAppUrl()}/sources/${encodeURIComponent(detail.name)}`
  return {
    title,
    description,
    // Parallel to /leaderboard/sources's own experimental/noindex status until the
    // shadow-scoring feature graduates out of experimental.
    robots: { index: false },
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website' },
  }
}

export default async function OutletPublicPage({ params }: Props) {
  const { name } = await params

  const [detail, { outletRows, authorRows }, topicBoards, locale] = await Promise.all([
    getPublicOutletDetail(decodeURIComponent(name)),
    getSourceLeaderboard('outlets', 'skillConservative'),
    getTopicBoards(),
    getLocale(),
  ])
  if (!detail) notFound()
  const publications = groupPublications(detail.publications)
  const [forecastRows, forecastLinks] = await Promise.all([
    getOutletForecastRows(detail.name, detail.domains, locale),
    getPublicForecastLinks(publications.flatMap((p) => p.forecasts.map((f) => f.forecastId)), locale),
  ])

  // The leaderboard keys outlets by domain, forecast pages link by display name ("Ynet"), so
  // match on every domain news-indexer knows for this outlet, not just the name in the URL (#1891).
  const keys = new Set([detail.name, ...detail.domains].map(canonicalOutlet))
  const track = outletRows.find(r => keys.has(r.outletName))
  // Rank as the public board shows it: same order, same sample-size floor.
  const ranked = outletRows.filter(r => r.predictions >= SOURCE_LEADERBOARD_MIN_PREDICTIONS)
  const rank = track ? ranked.findIndex(r => r.outletName === track.outletName) : -1
  // The scored authors behind the track record. Same key as `track`, so the numbers above
  // and this list always describe the same rows.
  const scoredAuthors = track ? authorsOfOutlet(authorRows, track.outletName) : []
  const topics = outletTopicRecords(topicBoards, keys)

  const shownName = localizedText(detail.displayName, locale) ?? detail.name
  const description = localizedText(detail.description, locale)
  const articleTotal = forecastRows.reduce((n, r) => n + r.articles, 0)
  const lastArticle = forecastRows.reduce<string | null>((d, r) => (!d || r.lastArticle > d ? r.lastArticle : d), null)
  const date = (iso: string) =>
    new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' })

  const t = await getTranslations('outletPage')
  const tBoard = await getTranslations('sourceLeaderboard')

  const links = [
    ...(detail.wikipediaUrl ? [{ label: t('wikipedia'), url: detail.wikipediaUrl }] : []),
    ...(detail.telegramChannel ? [{ label: t('telegram'), url: telegramHref(detail.telegramChannel) }] : []),
    ...detail.links,
  ]

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <Link
        href="/leaderboard/sources"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6"
      >
        <Newspaper className="w-4 h-4" />
        {t('backToLeaderboard')}
      </Link>

      <header className="pb-8 border-b border-navy-700">
        <div className="flex items-center gap-4">
          <span
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-navy-600 text-lg font-black text-gray-300"
            aria-hidden="true"
          >
            {shownName.trim().charAt(0).toUpperCase()}
          </span>
          <h1 dir="auto" className="text-2xl sm:text-3xl font-bold text-white">{shownName}</h1>
        </div>

        {description && <p dir="auto" className="mt-4 max-w-2xl text-gray-300 leading-relaxed">{description}</p>}

        {links.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {links.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                 className="inline-flex items-center gap-1.5 rounded-full border border-navy-600 px-3 py-1 text-xs text-gray-300 hover:border-gray-500 hover:text-white">
                {l.label} <ExternalLink className="w-3 h-3" />
              </a>
            ))}
          </div>
        )}

        <p className="mt-5 max-w-2xl text-sm text-gray-400 leading-relaxed">{t('lead', { name: shownName })}</p>

        <dl className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-x-6 gap-y-5">
          <Stat
            label={t('trackRecord')}
            value={track ? t(`grade.${brierGrade(track.brierScore)}`) : '—'}
            tone={track ? brierTone(track.brierScore) : undefined}
            note={track ? t('gradeNote', { brier: track.brierScore.toFixed(2), count: track.predictions }) : t('noTrackRecord')}
            warn={track && track.predictions < LOW_SAMPLE ? t('lowSample') : undefined}
          />
          {rank >= 0 && (
            <Stat
              label={t('rankLabel')}
              value={t('rankValue', { rank: rank + 1, total: ranked.length })}
              href="/leaderboard/sources?view=outlets"
            />
          )}
          <Stat label={t('forecastsCovered')} value={String(forecastRows.length)} />
          <Stat label={t('articlesCited')} value={String(articleTotal)} />
          {lastArticle && <Stat label={t('lastArticle')} value={date(lastArticle)} />}
        </dl>
        {track && <p className="mt-4 text-xs text-gray-500">{t('trackRecordHint')}</p>}
      </header>

      <section className="pt-8">
        <h2 className="text-lg font-bold text-white">
          {t('forecastsTitle')} <span className="text-gray-500 font-normal">({forecastRows.length})</span>
        </h2>
        <p className="mt-1 mb-4 text-xs text-gray-500 max-w-2xl">{t('forecastsHint')}</p>
        {forecastRows.length > 0 ? (
          <OutletForecastTable rows={sortOutletForecasts(forecastRows)} />
        ) : (
          <p className="text-sm text-gray-500">{t('noForecasts')}</p>
        )}
      </section>

      {/* A list, not a table (#2292): under auto table layout a long title ran over the
          forecast column, and one article that fed two forecasts printed as two rows.
          dir="auto": most titles are Hebrew, and on an English page their quotes and
          trailing punctuation otherwise jump to the wrong end. */}
      {publications.length > 0 && (
        <section className="pt-10">
          <h2 className="text-lg font-bold text-white mb-3">
            {t('publications')} <span className="text-gray-500 font-normal">({publications.length})</span>
          </h2>
          <ShowMoreList
            initial={INITIAL_PUBLICATIONS}
            moreLabel={t('showMore')}
            className="rounded-lg border border-navy-600 divide-y divide-navy-700"
            items={publications.map((p, i) => {
              const fed = p.forecasts.flatMap((f) => {
                const link = forecastLinks.get(f.forecastId)
                return link ? [{ ...f, ...link }] : []
              })
              return (
                <li key={`${p.url ?? 'row'}-${i}`} className="px-4 py-3 break-words">
                  {isUrl(p.url) ? (
                    <a href={p.url} target="_blank" rel="noopener noreferrer" dir="auto"
                       className="text-sm text-blue-400 hover:underline">
                      {p.title || p.url}
                      <ExternalLink className="inline w-3 h-3 ms-1 align-baseline" />
                    </a>
                  ) : (
                    <span dir="auto" className="text-sm text-white">{p.title || '—'}</span>
                  )}
                  {p.publishedAt && (
                    <time dateTime={p.publishedAt} className="block mt-1 text-xs text-gray-500">{date(p.publishedAt)}</time>
                  )}
                  {fed.map((f) => (
                    <div key={f.forecastId} className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                      <Link href={f.href} dir="auto" className="text-cyan-400 hover:underline">{f.title}</Link>
                      {f.outcome && (
                        <span className="px-1.5 py-0.5 rounded bg-navy-800 border border-navy-600 text-gray-300">
                          {OUTCOME_LABEL[f.outcome] ? t(OUTCOME_LABEL[f.outcome]) : f.outcome}
                        </span>
                      )}
                    </div>
                  ))}
                </li>
              )
            })}
          />
        </section>
      )}

      <section className="pt-10">
        <TopicBreakdown records={topics} view="outlets" />
      </section>

      {scoredAuthors.length > 0 && (
        <section className="pt-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
            {t('scoredAuthors')} ({scoredAuthors.length})
          </h3>
          <ShowMoreTable
            initial={INITIAL_AUTHORS}
            moreLabel={t('showAllAuthors', { count: scoredAuthors.length })}
            className="overflow-x-auto rounded-lg border border-navy-600"
            head={
              <tr className="text-start text-gray-500 border-b border-navy-600">
                <th className="px-3 py-2 font-medium text-start">{t('author')}</th>
                <th className="px-3 py-2 font-medium text-end">{t('skill')}</th>
                <th className="px-3 py-2 font-medium text-end">{t('brier')}</th>
                <th className="px-3 py-2 font-medium text-end">{t('predictions')}</th>
              </tr>
            }
            rows={scoredAuthors.map(a => (
              <tr key={a.id} className="border-t border-navy-700 first:border-t-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/authors/${encodeURIComponent(a.author)}/${encodeURIComponent(a.outletName)}`}
                    className="text-white hover:underline hover:text-cyan-300"
                  >
                    {a.author}
                  </Link>
                  {a.isDesk && <DeskBadge label={tBoard('deskBadge')} hint={tBoard('deskBadgeHint')} />}
                </td>
                <td className="px-3 py-2 text-end font-mono text-cyan-300">{a.skillConservative.toFixed(3)}</td>
                <td className="px-3 py-2 text-end font-mono text-gray-300">{a.brierScore.toFixed(3)}</td>
                <td className="px-3 py-2 text-end text-gray-500">{a.predictions}</td>
              </tr>
            ))}
          />
        </section>
      )}

      {detail.linkedPeople.length > 0 && (
        <section className="pt-8">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">{t('linkedPeople')}</h3>
          <div className="flex flex-wrap gap-1.5">
            {detail.linkedPeople.map(p => (
              <span key={p.id} className="inline-flex items-center px-3 py-1 text-xs text-gray-300 bg-navy-900 border border-navy-600 rounded-full">
                {p.canonicalName}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value, note, warn, tone, href }: {
  label: string
  value: string
  note?: string
  warn?: string
  tone?: string
  href?: string
}) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">{label}</dt>
      <dd className={`text-xl font-black ${tone ?? 'text-white'}`}>
        {href ? <Link href={href} className="underline decoration-navy-600 underline-offset-4 hover:text-cyan-300">{value}</Link> : value}
      </dd>
      {note && <dd className="mt-0.5 text-xs text-gray-500">{note}</dd>}
      {warn && <dd className="mt-0.5 text-xs text-amber-400">{warn}</dd>}
    </div>
  )
}
