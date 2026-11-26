import type { Metadata } from 'next'
import { Fragment } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { ExternalLink, Newspaper } from 'lucide-react'
import { getPublicOutletDetail } from '@/lib/services/outlets'
import { localizedText, telegramHref } from '@/lib/utils/outlet-identity'
import { outletLogo } from '@/lib/utils/outlet-logos'
import { outletProfile, sourceLabel } from '@/lib/utils/outlet-profiles'
import { getOutletForecastRows, getPublicForecastLinks } from '@/lib/services/outlet-forecasts'
import { groupPublications } from '@/lib/utils/group-publications'
import { pickCalls, sortOutletForecasts } from '@/lib/utils/outlet-forecasts'
import { brierGrade } from '@/lib/utils/brier-grade'
import { authorsOfOutlet, canonicalOutlet, getSourceLeaderboard } from '@/lib/services/sourceLeaderboard'
import { getBoardOutlets, SOURCE_LEADERBOARD_MIN_PREDICTIONS } from '@/lib/services/leaderboard-cached'
import { getTopicBoards, outletTopicRecords } from '@/lib/services/sourceTopicBoards'
import TopicBreakdown from '@/components/sources/TopicBreakdown'
import OutletForecastTable from '@/components/sources/OutletForecastTable'
import OutletCalls from '@/components/sources/OutletCalls'
import { ShowMoreList, ShowMoreTable } from '@/components/sources/ShowMore'
import { brierTone } from '@/components/leaderboard/LeaderboardParts'
import { getAppUrl } from '@/lib/branding'
import DeskBadge from '@/components/sources/DeskBadge'
import { JsonLd } from '@/components/JsonLd'


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

  const [locale, board, t] = await Promise.all([getLocale(), getBoardOutlets(), getTranslations('outletPage')])
  // Same row lookup as the page body (#1891), so the page is indexed exactly when it shows a
  // track record.
  const keys = new Set([detail.name, ...detail.domains].map(canonicalOutlet))
  const place = board.findIndex((r) => keys.has(r.outletName))
  const shown = localizedText(detail.displayName, locale) ?? detail.name
  // Bare title: the root layout's `%s | DAATAN` template adds the brand.
  const title = `${shown} — source profile`
  // The board's own numbers lead the snippet (daatan#2339); off the board the page is noindex.
  const stats = place >= 0
    ? t('metaBoard', {
        name: shown,
        brier: board[place].brierScore.toFixed(2),
        count: board[place].predictions,
        rank: place + 1,
        total: board.length,
      })
    : null
  const description =
    [stats, localizedText(detail.description, locale)].filter(Boolean).join(' ') ||
    `Track record, publications, and identity info for ${shown} on Daatan.`
  const url = `${getAppUrl()}/sources/${encodeURIComponent(detail.name)}`
  return {
    title,
    description,
    // Indexed once the outlet is on the public board, as that board is (#1588); below its
    // threshold the page is too thin to submit (daatan#2337).
    robots: { index: place >= 0 },
    alternates: { canonical: url },
    openGraph: { title, description, url, type: 'website' },
  }
}

/** About three lines on a phone; a longer outlet paragraph folds behind "Show more". */
const ABOUT_FOLD_CHARS = 280

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
  const logo = outletLogo(keys)

  const shownName = localizedText(detail.displayName, locale) ?? detail.name
  const description = localizedText(detail.description, locale)
  const calls = pickCalls(forecastRows)
  // Exact names, not canonical ones: an alias domain is a different outlet with its own article.
  const profile = outletProfile([detail.name, ...detail.domains], locale)
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

  // Identity only (daatan#2339): who the outlet is and where it lives, not its grade.
  const site = detail.domains[0] ? `https://${detail.domains[0]}` : null
  const sameAs = [detail.wikipediaUrl, detail.telegramChannel ? telegramHref(detail.telegramChannel) : null]
    .filter((u): u is string => !!u)
  const pageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    url: `${getAppUrl()}/sources/${encodeURIComponent(detail.name)}`,
    name: `${shownName} — source profile`,
    about: {
      '@type': 'Organization',
      name: shownName,
      ...(site ? { url: site } : {}),
      ...(logo ? { logo: `${getAppUrl()}${logo.src}` } : {}),
      ...(sameAs.length > 0 ? { sameAs } : {}),
    },
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <JsonLd data={pageJsonLd} />
      <Link
        href="/leaderboard/sources"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6"
      >
        <Newspaper className="w-4 h-4" />
        {t('backToLeaderboard')}
      </Link>

      <header className="pb-8 border-b border-navy-700">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {logo ? (
            // A light plate: most wordmarks are dark ink on transparent and vanish on navy.
            <span className="inline-flex shrink-0 items-center rounded-md bg-white px-3 py-2">
              <Image src={logo.src} alt="" width={logo.width} height={logo.height} />
            </span>
          ) : (
            <span
              className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-navy-600 text-lg font-black text-gray-300"
              aria-hidden="true"
            >
              {shownName.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <h1 dir="auto" className="text-2xl sm:text-3xl font-bold text-white">{shownName}</h1>
        </div>

        {description && <p dir="auto" className="mt-4 max-w-2xl text-gray-300 leading-relaxed">{description}</p>}

        {profile && profile.facts.length > 0 && (
          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
            {profile.facts.map(f => (
              <div key={f.key}>
                <dt className="text-xs font-semibold uppercase tracking-wider text-gray-500">{t(`fact.${f.key}`)}</dt>
                <dd dir="auto" className="mt-0.5 text-sm text-gray-200">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {profile?.about && (
          <div className="mt-4 max-w-2xl">
            {/* A long lead folds to four lines so the stats stay near the top; the text stays whole in the DOM. CSS-only, no client JS. */}
            {profile.about.text.length > ABOUT_FOLD_CHARS && <input type="checkbox" id="outlet-about-more" className="peer sr-only" />}
            {/* Direction from the text's language: a Hebrew paragraph that opens with a Latin name would read as LTR under dir="auto". */}
            <p
              lang={profile.about.lang}
              dir={profile.about.lang === 'he' ? 'rtl' : 'ltr'}
              className={profile.about.text.length > ABOUT_FOLD_CHARS
                ? 'text-gray-300 leading-relaxed line-clamp-4 peer-checked:line-clamp-none'
                : 'text-gray-300 leading-relaxed'}
            >
              {profile.about.text}
            </p>
            {profile.about.text.length > ABOUT_FOLD_CHARS && (
              <label htmlFor="outlet-about-more" className="mt-1 inline-block cursor-pointer text-sm text-blue-400 hover:underline peer-checked:hidden peer-focus-visible:underline">
                {t('showMore')}
              </label>
            )}
          </div>
        )}

        {profile && (profile.factSources.length > 0 || profile.about) && (
          <p className="mt-2 max-w-2xl text-xs text-gray-500">
            {profile.factSources.length > 0 && (
              <>
                {t('factsFrom')}{' '}
                {profile.factSources.map((u, i) => (
                  <Fragment key={u}>
                    {i > 0 && ', '}
                    <a href={u} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">{sourceLabel(u)}</a>
                  </Fragment>
                ))}
              </>
            )}
            {profile.factSources.length > 0 && profile.about && ' · '}
            {profile.about?.kind === 'wikipedia' && (
              // CC BY-SA 4.0 asks for the article link and the licence next to the text.
              <>
                <a href={profile.about.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">{t('fromWikipedia')}</a>
                {', '}
                <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer license" className="whitespace-nowrap underline hover:text-gray-300">CC BY-SA 4.0</a>
              </>
            )}
            {profile.about?.kind === 'researched' && (
              <>
                {t('researchedFrom')}{' '}
                {profile.about.sources.map((u, i) => (
                  <Fragment key={u}>
                    {i > 0 && ', '}
                    <a href={u} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-300">{sourceLabel(u)}</a>
                  </Fragment>
                ))}
              </>
            )}
          </p>
        )}

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
              note={t('rankNote')}
              href="/leaderboard/sources?view=outlets"
            />
          )}
          <Stat label={t('forecastsCovered')} value={String(forecastRows.length)} />
          <Stat label={t('articlesCited')} value={String(articleTotal)} />
          {lastArticle && <Stat label={t('lastArticle')} value={date(lastArticle)} />}
        </dl>
        {track && <p className="mt-4 text-xs text-gray-500">{t('trackRecordHint')}</p>}
      </header>

      {(calls.heldUp.length > 0 || calls.missed.length > 0) && <OutletCalls {...calls} />}

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
