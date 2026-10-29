import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ExternalLink, Newspaper } from 'lucide-react'
import { getPublicOutletDetail } from '@/lib/services/outlets'
import { getForecastSlugs } from '@/lib/services/forecast'
import { authorsOfOutlet, canonicalOutlet, getSourceLeaderboard } from '@/lib/services/sourceLeaderboard'
import { getTopicBoards, outletTopicRecords } from '@/lib/services/sourceTopicBoards'
import TopicBreakdown from '@/components/sources/TopicBreakdown'
import { getAppUrl } from '@/lib/branding'
import DeskBadge from '@/components/sources/DeskBadge'


interface Props {
  params: Promise<{ name: string }>
}

/** Below this many resolved predictions a skill/Brier number is mostly noise. */
const LOW_SAMPLE = 30

function isUrl(s: string | null | undefined): s is string {
  return !!s && /^https?:\/\//.test(s)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params
  const detail = await getPublicOutletDetail(decodeURIComponent(name))
  if (!detail) return { title: 'Source Not Found', robots: { index: false, follow: false } }

  const title = `${detail.name} — source profile | Daatan`
  const description = `Track record, publications, and identity info for ${detail.name} on Daatan.`
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

  const [detail, { outletRows, authorRows }, topicBoards] = await Promise.all([
    getPublicOutletDetail(decodeURIComponent(name)),
    getSourceLeaderboard('outlets', 'skillConservative'),
    getTopicBoards(),
  ])
  if (!detail) notFound()
  const forecastSlugs = await getForecastSlugs(
    detail.publications.flatMap((p) => (p.forecastId ? [p.forecastId] : [])),
  )

  // The leaderboard keys outlets by domain, forecast pages link by display name ("Ynet"), so
  // match on every domain news-indexer knows for this outlet, not just the name in the URL (#1891).
  const keys = new Set([detail.name, ...detail.domains].map(canonicalOutlet))
  const track = outletRows.find(r => keys.has(r.outletName))
  // The scored authors behind the track record. Same key as `track`, so the numbers above
  // and this list always describe the same rows.
  const scoredAuthors = track ? authorsOfOutlet(authorRows, track.outletName) : []
  const topics = outletTopicRecords(topicBoards, keys)
  const noImpact =
    detail.impact.forecastsAffected === 0 && detail.impact.matches === 0 && detail.impact.last30dMatches === 0
  const t = await getTranslations('outletPage')
  const tBoard = await getTranslations('sourceLeaderboard')

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <Link
        href="/leaderboard/sources"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4"
      >
        <Newspaper className="w-4 h-4" />
        {t('backToLeaderboard')}
      </Link>

      <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1">{detail.name}</h1>
      {detail.sourceConfig && (
        <p className="text-sm text-gray-400 mb-4">
          {detail.sourceConfig.type} · {detail.sourceConfig.language || '—'}
        </p>
      )}

      {(detail.wikipediaUrl || detail.telegramChannel || detail.links.length > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-2 mb-6 text-sm">
          {detail.wikipediaUrl && (
            <a href={detail.wikipediaUrl} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-blue-400 hover:underline">
              {t('wikipedia')} <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {detail.telegramChannel && (
            <a href={`https://t.me/${detail.telegramChannel}`} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-blue-400 hover:underline">
              {t('telegram')} <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {detail.links.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-blue-400 hover:underline">
              {l.label} <ExternalLink className="w-3 h-3" />
            </a>
          ))}
        </div>
      )}

      <div className="p-4 rounded-xl bg-navy-700 border border-navy-600 mb-8">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">{t('trackRecord')}</h2>
        {track ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label={t('skill')} value={track.skillConservative.toFixed(3)} />
              <Stat label={t('brier')} value={track.brierScore.toFixed(3)} />
              <Stat label={t('authors')} value={String(track.authorCount)} />
              <Stat label={t('predictions')} value={String(track.predictions)} />
            </div>
            <p className="text-xs text-gray-500 mt-3">
              {t('brierHint')}
              {track.predictions < LOW_SAMPLE && (
                <span className="text-amber-400"> · {t('lowSample', { count: track.predictions })}</span>
              )}
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-500">{t('noTrackRecord')}</p>
        )}
      </div>

      {noImpact ? (
        <p className="text-sm text-gray-500 mb-8">{t('noImpact')}</p>
      ) : (
        <div className="grid grid-cols-3 gap-3 mb-8">
          <Stat label={t('forecastsAffected')} hint={t('impactHint')} value={String(detail.impact.forecastsAffected)} big />
          <Stat label={t('matches')} hint={t('impactHint')} value={String(detail.impact.matches)} big />
          <Stat label={t('last30dMatches')} hint={t('impactHint')} value={String(detail.impact.last30dMatches)} big highlight />
        </div>
      )}

      <TopicBreakdown records={topics} view="outlets" />

      {scoredAuthors.length > 0 && (
        <>
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
            {t('scoredAuthors')} ({scoredAuthors.length})
          </h3>
          <div className="overflow-x-auto rounded-lg border border-navy-600 mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-navy-600">
                  <th className="px-3 py-2 font-medium">{t('author')}</th>
                  <th className="px-3 py-2 font-medium text-right">{t('skill')}</th>
                  <th className="px-3 py-2 font-medium text-right">{t('brier')}</th>
                  <th className="px-3 py-2 font-medium text-right">{t('predictions')}</th>
                </tr>
              </thead>
              <tbody>
                {scoredAuthors.map(a => (
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
                    <td className="px-3 py-2 text-right font-mono text-cyan-300">{a.skillConservative.toFixed(3)}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-300">{a.brierScore.toFixed(3)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">{a.predictions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {(detail.linkedPeople.length > 0 || scoredAuthors.length === 0) && (
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">{t('linkedPeople')}</h3>
      )}
      {detail.linkedPeople.length === 0 ? (
        scoredAuthors.length === 0 && <p className="text-sm text-gray-500 mb-8">{t('noLinkedPeople')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 mb-8">
          {detail.linkedPeople.map(p => (
            <span key={p.id} className="inline-flex items-center px-3 py-1 text-xs text-gray-300 bg-navy-900 border border-navy-600 rounded-full">
              {p.canonicalName}
            </span>
          ))}
        </div>
      )}

      {detail.publications.length > 0 && (
        <>
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
            {t('publications')} ({detail.publications.length})
          </h3>
          <div className="overflow-x-auto rounded-lg border border-navy-600">
            <table className="w-full text-sm">
              <tbody>
                {detail.publications.map((p, i) => (
                  <tr key={i} className="border-t border-navy-700 first:border-t-0">
                    <td className="px-3 py-2 max-w-[26rem]">
                      {isUrl(p.url) ? (
                        <a href={p.url} target="_blank" rel="noopener noreferrer"
                           className="inline-flex items-center gap-1 text-blue-500 hover:underline truncate">
                          <span className="truncate">{p.title || p.url}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-white">{p.title || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {p.forecastId ? (
                        <Link href={`/forecasts/${forecastSlugs.get(p.forecastId) ?? p.forecastId}`} className="text-blue-500 hover:underline">
                          {t('forecast')}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-400">{p.outcome || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, big, highlight, hint }: { label: string; value: string; big?: boolean; highlight?: boolean; hint?: string }) {
  return (
    <div title={hint} className="p-3 rounded-lg bg-navy-800 border border-navy-600">
      <div className={`font-bold ${highlight ? 'text-emerald-400' : 'text-white'} ${big ? 'text-2xl' : 'text-lg'}`}>{value}</div>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
    </div>
  )
}
