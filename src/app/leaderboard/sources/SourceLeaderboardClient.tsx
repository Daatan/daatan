'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Hash, Newspaper, PenLine, Scale, Swords, TrendingDown, Zap } from 'lucide-react'
import type {
  AuthorLeaderboardRow,
  OutletLeaderboardRow,
  SourceLeaderboardView,
} from '@/lib/services/sourceLeaderboard'
import EmptyState from '@/components/ui/EmptyState'
import DeskBadge from '@/components/sources/DeskBadge'
import {
  BODY, BoardTabs, ColumnHint, HEAD_CELL, HEAD_ROW, LEGEND_GRID, LegendCard, LowerIsBetter, RankBadge, TABLE_CARD,
  brierTone, pillClass, valueSize,
} from '@/components/leaderboard/LeaderboardParts'
import { compareSideRate } from '@/lib/utils/side-rate'
import { compareBits, formatBits } from '@/lib/utils/bits'
import { parseView } from './view'

const VIEWS: SourceLeaderboardView[] = ['outlets', 'authors']
const VIEW_ICON = { outlets: Newspaper, authors: PenLine }

type SortKey = 'name' | 'secondary' | 'skill' | 'brier' | 'side' | 'bits' | 'predictions'
type SortDir = 'asc' | 'desc'
const SORT_KEYS: SortKey[] = ['name', 'secondary', 'skill', 'brier', 'side', 'bits', 'predictions']
/** First click on a column: text sorts A→Z, Brier lower-is-better, the rest biggest first. */
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc', secondary: 'asc', skill: 'desc', brier: 'asc', side: 'desc', bits: 'desc', predictions: 'desc',
}

/** A long domain (timesofindia.indiatimes.com) may wrap after a dot, never mid-word, so on a
 *  phone the name column doesn't push Bits off a 360 px screen (#2259). */
function breakAfterDots(name: string) {
  return name.split(/(?<=\.)/).flatMap((part, i) => (i ? [<wbr key={i} />, part] : [part]))
}

function boardHref(view: SourceLeaderboardView, sort: SortKey, dir: SortDir, tag: string | null): string {
  return `/leaderboard/sources?view=${view}&sort=${sort}&dir=${dir}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`
}

/** Rows for the URL's view and tag, rendered on the server (#2212); a view or tag change is a
 *  Link navigation, so the server page re-renders with fresh props. */
export default function SourceLeaderboardClient({ authorRows, outletRows, hidden, tags }: {
  authorRows: AuthorLeaderboardRow[]
  outletRows: OutletLeaderboardRow[]
  hidden: { authors: number; outlets: number; min: number }
  tags: { slug: string; name: string }[]
}) {
  const t = useTranslations('sourceLeaderboard')
  const tl = useTranslations('leaderboard')
  const searchParams = useSearchParams()
  const view = parseView(searchParams.get('view'))
  // `sortBy=brierScore` is the pre-sortable-columns URL; keep old links working.
  const legacyBrier = searchParams.get('sortBy') === 'brierScore'
  const sortParam = searchParams.get('sort') as SortKey | null
  // "Takes a side" is an authors-only column (#2231); the outlets view keeps its default order.
  const sort: SortKey = sortParam && SORT_KEYS.includes(sortParam) && !(sortParam === 'side' && view === 'outlets')
    ? sortParam
    : legacyBrier ? 'brier' : 'skill'
  const dirParam = searchParams.get('dir')
  const dir: SortDir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : DEFAULT_DIR[sort]

  const tag = searchParams.get('tag')

  // Normalize both views to one display shape so the table only renders once.
  const rows = view === 'outlets'
    ? outletRows.map(r => ({
        id: r.id,
        primary: r.outletName,
        href: `/sources/${encodeURIComponent(r.outletName)}`,
        secondary: t('authorsCount', { count: r.authorCount }),
        desk: false,
        secondarySort: r.authorCount,
        skillConservative: r.skillConservative,
        brierScore: r.brierScore,
        bits: r.bits ?? null,
        predictions: r.predictions,
        sideTaken: null,
        sideTotal: null,
      }))
    : authorRows.map(r => ({
        id: r.id,
        primary: r.author,
        href: `/authors/${encodeURIComponent(r.author)}/${encodeURIComponent(r.outletName)}`,
        secondary: r.outletName,
        desk: r.isDesk === true,
        secondarySort: r.outletName.toLowerCase(),
        skillConservative: r.skillConservative,
        brierScore: r.brierScore,
        bits: r.bits ?? null,
        predictions: r.predictions,
        sideTaken: r.sideTaken ?? null,
        sideTotal: r.sideTotal ?? null,
      }))

  const hiddenCount = view === 'outlets' ? hidden.outlets : hidden.authors
  const hiddenNote = hiddenCount > 0 && (
    <p className="text-sm text-gray-500 mt-3">
      {t(view === 'outlets' ? 'hiddenOutlets' : 'hiddenAuthors', { count: hiddenCount, min: hidden.min })}
    </p>
  )

  // Rank counts from the best, as on the user board: reversing the order doesn't renumber. It
  // follows Brier when the board is sorted by Brier, and Skill (the default ranking) otherwise.
  const rankByBrier = sort === 'brier'
  const ranked = [...rows].sort((a, b) =>
    (rankByBrier ? a.brierScore - b.brierScore : b.skillConservative - a.skillConservative)
    || a.primary.localeCompare(b.primary))
  const rankById = new Map(ranked.map((r, i) => [r.id, i]))
  const byRank = sort === 'brier' || sort === 'skill'
  const bestFirst = byRank && dir === DEFAULT_DIR[sort]

  const sign = dir === 'asc' ? 1 : -1
  const sortValue = (r: (typeof rows)[number]): string | number =>
    sort === 'name' ? r.primary.toLowerCase()
      : sort === 'secondary' ? r.secondarySort
        : r.predictions
  // Sorted by the rank metric, the rows are the ranking itself (reversed for worst-first), so
  // tied scores keep their numbers in order either way.
  const sortedRows = byRank
    ? (bestFirst ? ranked : [...ranked].reverse())
    : [...rows].sort((a, b) => {
        if (sort === 'side') return compareSideRate(a, b, dir) || a.primary.localeCompare(b.primary)
        if (sort === 'bits') return compareBits(a, b, dir) || a.primary.localeCompare(b.primary)
        const av = sortValue(a)
        const bv = sortValue(b)
        const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : (av as number) - (bv as number)
        return cmp * sign || a.primary.localeCompare(b.primary)
      })

  // On phones the outlet / author count moves under the name (like @username on the user board),
  // unless the board is sorted by it.
  const secondaryVisibility = sort === 'secondary' ? '' : 'hidden sm:table-cell'
  // "Takes a side" gives way to Bits on phones the same way (#2259): with both, Bits sat past
  // the right edge of a 360 px screen.
  const sideVisibility = sort === 'side' ? '' : 'hidden sm:table-cell'

  const columns: { key: SortKey; label: string; hint?: string; lowerIsBetter?: boolean; align: 'left' | 'right'; className: string }[] = [
    { key: 'name', label: view === 'outlets' ? t('outlet') : t('author'), align: 'left', className: 'px-2 sm:px-4' },
    { key: 'secondary', label: view === 'outlets' ? t('authors') : t('outlet'), align: 'left', className: `px-2 sm:px-4 ${secondaryVisibility}` },
    { key: 'skill', label: t('skillConservative'), hint: t('legend.skillDesc'), align: 'right', className: 'px-2 sm:px-4' },
    { key: 'brier', label: t('brierScore'), hint: t('legend.brierDesc'), lowerIsBetter: true, align: 'right', className: 'px-2 sm:px-4' },
    ...(view === 'authors'
      ? [{ key: 'side' as const, label: t('sideRate'), hint: t('sideRateHint'), align: 'right' as const, className: `px-2 sm:px-4 ${sideVisibility}` }]
      : []),
    { key: 'bits', label: t('bits'), hint: t('legend.bitsDesc'), align: 'right', className: 'px-2 sm:px-4' },
    { key: 'predictions', label: t('predictions'), hint: t('legend.predictionsDesc'), align: 'right', className: 'px-2 sm:px-4' },
  ]

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <BoardTabs
        active="sources"
        ariaLabel={tl('boards.nav')}
        labels={{ users: tl('boards.users'), ai: tl('boards.ai'), sources: tl('boards.sources') }}
      />

      <div className="flex items-center gap-3 mb-2">
        <Newspaper className="w-7 h-7 text-cyan-400" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('title')}</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6 max-w-2xl">{t('explainer')}</p>

      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1 scrollbar-hide">
        {VIEWS.map(v => {
          const Icon = VIEW_ICON[v]
          return (
            <Link
              key={v}
              rel="nofollow"
              href={boardHref(v, sort, dir, tag)}
              aria-current={v === view ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                v === view ? 'bg-blue-600 text-white shadow-sm' : 'bg-navy-700 text-text-secondary hover:bg-navy-600'
              }`}
            >
              <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              {t(`view.${v}`)}
            </Link>
          )
        })}
      </div>

      {tags.length > 0 && (
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1 scrollbar-hide">
          <span className="text-xs text-gray-500 whitespace-nowrap flex-shrink-0">{tl('filterByTopic')}:</span>
          {[{ slug: null, name: tl('allTopics') }, ...tags].map(tg => (
            <Link
              key={tg.slug ?? 'all'}
              rel="nofollow"
              href={boardHref(view, sort, dir, tg.slug)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap flex-shrink-0 ${pillClass((tag ?? null) === tg.slug)}`}
            >
              {tg.name}
            </Link>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <>
          <EmptyState
            icon={<Newspaper className="w-10 h-10" />}
            title={t('emptyTitle')}
            description={t('emptyDesc')}
          />
          {hiddenNote}
        </>
      ) : (
        <>
          {/* overflow-x-auto, not overflow-hidden: on a phone the table can be a little wider
              than the screen (the authors view, long names) and must scroll sideways; any
              non-visible overflow still clips to the rounded corners (#2236). */}
          <div className={`${TABLE_CARD} overflow-x-auto`}>
            <table className="w-full text-left">
              <thead>
                <tr className={HEAD_ROW}>
                  <th className={`px-1 sm:px-4 ${HEAD_CELL} text-gray-500 text-center w-10 sm:w-20`}>
                    {/* "#" on phones: the word does not fit the narrow rank column. */}
                    <span className="sm:hidden" aria-hidden="true">#</span>
                    <span className="sr-only sm:not-sr-only">{tl('rank')}</span>
                  </th>
                  {columns.map(c => {
                    const active = c.key === sort
                    const nextDir: SortDir = active ? (dir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[c.key]
                    const hintId = c.hint ? `src-hint-${c.key}` : undefined
                    return (
                      <th
                        key={c.key}
                        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        className={`${c.className} ${HEAD_CELL} relative group ${c.align === 'right' ? 'text-right' : 'text-left'} ${
                          active ? 'text-white' : 'text-gray-500'
                        }`}
                      >
                        <Link
                          rel="nofollow"
                          href={boardHref(view, c.key, nextDir, tag)}
                          replace
                          aria-describedby={hintId}
                          className="inline-block hover:text-white transition-colors"
                        >
                          {c.label}
                          {active && <span aria-hidden="true">{dir === 'asc' ? ' ↑' : ' ↓'}</span>}
                          {c.lowerIsBetter && <LowerIsBetter label={tl('lowerIsBetter')} />}
                        </Link>
                        {hintId && <ColumnHint id={hintId}>{c.hint}</ColumnHint>}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody className={BODY}>
                {sortedRows.map(row => {
                  const rank = rankById.get(row.id) ?? 0
                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-white/5 transition-colors ${rank < 3 && bestFirst ? 'bg-amber-400/5' : ''}`}
                    >
                      <td className="px-1 sm:px-4 py-3 sm:py-4">
                        <div className="flex justify-center"><RankBadge rank={rank} /></div>
                      </td>
                      <td className="px-2 sm:px-4 py-3 sm:py-4 font-bold text-white text-sm sm:text-base">
                        <Link href={row.href} className="hover:underline">
                          {breakAfterDots(row.primary)}
                        </Link>
                        {row.desk && <DeskBadge label={t('deskBadge')} hint={t('deskBadgeHint')} />}
                        {secondaryVisibility && (
                          <span className="sm:hidden block text-xs font-normal text-gray-500">{row.secondary}</span>
                        )}
                      </td>
                      <td className={`px-2 sm:px-4 py-3 sm:py-4 text-sm text-gray-400 ${secondaryVisibility}`}>{row.secondary}</td>
                      <td className={`px-2 sm:px-4 py-3 sm:py-4 text-right tabular-nums ${valueSize(sort === 'skill')} ${sort === 'skill' ? 'text-white' : 'text-text-secondary'}`}>
                        {/* dir=ltr: in he a leading minus otherwise lands after the digits (#2253) */}
                        <span dir="ltr">{row.skillConservative.toFixed(3)}</span>
                      </td>
                      <td className={`px-2 sm:px-4 py-3 sm:py-4 text-right tabular-nums ${valueSize(sort === 'brier')} ${brierTone(row.brierScore)}`}>
                        {row.brierScore.toFixed(3)}
                      </td>
                      {view === 'authors' && (
                        <td className={`px-2 sm:px-4 py-3 sm:py-4 text-right tabular-nums whitespace-nowrap ${sideVisibility} ${valueSize(sort === 'side')} ${sort === 'side' ? 'text-white' : 'text-text-secondary'}`}>
                          {row.sideTotal ? `${row.sideTaken}/${row.sideTotal}` : '—'}
                        </td>
                      )}
                      <td className={`px-2 sm:px-4 py-3 sm:py-4 text-right tabular-nums whitespace-nowrap ${valueSize(sort === 'bits')} ${sort === 'bits' ? 'text-white' : 'text-text-secondary'}`}>
                        <span dir="ltr">{formatBits(row.bits)}</span>
                      </td>
                      <td className={`px-2 sm:px-4 py-3 sm:py-4 text-right tabular-nums ${valueSize(sort === 'predictions')} ${sort === 'predictions' ? 'text-white' : 'text-gray-400'}`}>
                        {row.predictions}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {hiddenNote}
        </>
      )}

      <div className={LEGEND_GRID}>
        <LegendCard icon={<Swords className="w-4 h-4 text-orange-400" />} title={t('skillConservative')}>{t('legend.skillDesc')}</LegendCard>
        <LegendCard icon={<TrendingDown className="w-4 h-4 text-purple-500" />} title={t('sortBy.brierScore')}>{t('legend.brierDesc')}</LegendCard>
        {view === 'authors' && (
          <LegendCard icon={<Scale className="w-4 h-4 text-green-500" />} title={t('sideRate')}>{t('sideRateHint')}</LegendCard>
        )}
        <LegendCard icon={<Zap className="w-4 h-4 text-amber-400" />} title={t('bits')}>{t('legend.bitsDesc')}</LegendCard>
        <LegendCard icon={<Hash className="w-4 h-4 text-cyan-400" />} title={t('predictions')}>
          {t('legend.predictionsDesc')}
        </LegendCard>
      </div>

      <p className="text-xs text-gray-500 mt-4 max-w-2xl">{t('footnote')}</p>
    </div>
  )
}
