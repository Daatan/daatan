'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowDown, ArrowLeft, ArrowUp, Loader2, Newspaper } from 'lucide-react'
import type {
  AuthorLeaderboardRow,
  OutletLeaderboardRow,
  SourceLeaderboardView,
} from '@/lib/services/sourceLeaderboard'
import EmptyState from '@/components/ui/EmptyState'
import { createClientLogger } from '@/lib/client-logger'

const log = createClientLogger('SourceLeaderboard')

const VIEWS: SourceLeaderboardView[] = ['outlets', 'authors']

type SortKey = 'name' | 'secondary' | 'skill' | 'brier' | 'predictions'
type SortDir = 'asc' | 'desc'
const SORT_KEYS: SortKey[] = ['name', 'secondary', 'skill', 'brier', 'predictions']
/** First click on a column: text sorts A→Z, Brier lower-is-better, the rest biggest first. */
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc', secondary: 'asc', skill: 'desc', brier: 'asc', predictions: 'desc',
}

/** Lower Brier is better. 0.25 is a coin flip; colour by how far below that a score is. */
function brierTone(brier: number): string {
  if (brier <= 0.1) return 'text-emerald-400'
  if (brier <= 0.2) return 'text-lime-400'
  if (brier < 0.25) return 'text-yellow-400'
  return 'text-red-400'
}

function boardHref(view: SourceLeaderboardView, sort: SortKey, dir: SortDir): string {
  return `/leaderboard/sources?view=${view}&sort=${sort}&dir=${dir}`
}

export default function SourceLeaderboardPage() {
  const t = useTranslations('sourceLeaderboard')
  const searchParams = useSearchParams()
  const view: SourceLeaderboardView = searchParams.get('view') === 'authors' ? 'authors' : 'outlets'
  // `sortBy=brierScore` is the pre-sortable-columns URL; keep old links working.
  const legacyBrier = searchParams.get('sortBy') === 'brierScore'
  const sortParam = searchParams.get('sort') as SortKey | null
  const sort: SortKey = sortParam && SORT_KEYS.includes(sortParam) ? sortParam : legacyBrier ? 'brier' : 'skill'
  const dirParam = searchParams.get('dir')
  const dir: SortDir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : DEFAULT_DIR[sort]

  const [authorRows, setAuthorRows] = useState<AuthorLeaderboardRow[]>([])
  const [outletRows, setOutletRows] = useState<OutletLeaderboardRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)

    fetch(`/api/leaderboard/sources?view=${view}`)
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        setAuthorRows(data.authorRows ?? [])
        setOutletRows(data.outletRows ?? [])
      })
      .catch(err => log.error({ err }, 'Failed to fetch source leaderboard'))
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [view])

  // Normalize both views to one display shape so the table only renders once.
  const rows = view === 'outlets'
    ? outletRows.map(r => ({
        id: r.id,
        primary: r.outletName,
        href: `/sources/${encodeURIComponent(r.outletName)}`,
        secondary: t('authorsCount', { count: r.authorCount }),
        secondarySort: r.authorCount,
        skillConservative: r.skillConservative,
        brierScore: r.brierScore,
        predictions: r.predictions,
      }))
    : authorRows.map(r => ({
        id: r.id,
        primary: r.author,
        href: `/authors/${encodeURIComponent(r.author)}/${encodeURIComponent(r.outletName)}`,
        secondary: r.outletName,
        secondarySort: r.outletName.toLowerCase(),
        skillConservative: r.skillConservative,
        brierScore: r.brierScore,
        predictions: r.predictions,
      }))

  const sign = dir === 'asc' ? 1 : -1
  const sortValue = (r: (typeof rows)[number]): string | number =>
    sort === 'name' ? r.primary.toLowerCase()
      : sort === 'secondary' ? r.secondarySort
        : sort === 'skill' ? r.skillConservative
          : sort === 'brier' ? r.brierScore
            : r.predictions
  const sortedRows = [...rows].sort((a, b) => {
    const av = sortValue(a)
    const bv = sortValue(b)
    const cmp = typeof av === 'string' && typeof bv === 'string' ? av.localeCompare(bv) : (av as number) - (bv as number)
    return cmp * sign || a.primary.localeCompare(b.primary)
  })

  const columns: { key: SortKey; label: string; align: 'left' | 'right'; className: string }[] = [
    { key: 'name', label: view === 'outlets' ? t('outlet') : t('author'), align: 'left', className: 'px-2' },
    { key: 'secondary', label: view === 'outlets' ? t('authors') : t('outlet'), align: 'left', className: 'px-2' },
    { key: 'skill', label: t('skillConservative'), align: 'right', className: 'px-2' },
    { key: 'brier', label: t('brierScore'), align: 'right', className: 'px-2' },
    { key: 'predictions', label: t('predictions'), align: 'right', className: 'px-4 sm:px-6' },
  ]

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <Link
        href="/leaderboard"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        {t('backToLeaderboard')}
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <Newspaper className="w-7 h-7 text-cyan-400" />
        <h1 className="text-2xl sm:text-3xl font-bold text-white">{t('title')}</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6 max-w-2xl">{t('explainer')}</p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {VIEWS.map(v => (
          <Link
            key={v}
            href={boardHref(v, sort, dir)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              v === view ? 'bg-cyan-700 text-white' : 'bg-navy-700 text-gray-400 hover:text-white'
            }`}
          >
            {t(`view.${v}`)}
          </Link>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Newspaper className="w-10 h-10" />}
          title={t('emptyTitle')}
          description={t('emptyDesc')}
        />
      ) : (
        <div className="bg-navy-700 border border-navy-600 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-navy-600">
                <th className="px-4 sm:px-6 py-3 font-medium w-10">#</th>
                {columns.map(c => {
                  const active = c.key === sort
                  const nextDir: SortDir = active ? (dir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[c.key]
                  const Arrow = dir === 'asc' ? ArrowUp : ArrowDown
                  return (
                    <th
                      key={c.key}
                      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={`${c.className} py-3 font-medium ${c.align === 'right' ? 'text-right' : ''}`}
                    >
                      <Link
                        href={boardHref(view, c.key, nextDir)}
                        replace
                        className={`inline-flex items-center gap-1 hover:text-white ${active ? 'text-cyan-300' : ''}`}
                      >
                        {c.label}
                        {active && <Arrow className="w-3 h-3" aria-hidden="true" />}
                      </Link>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => (
                <tr key={row.id} className="border-b border-navy-600/50 last:border-0">
                  <td className="px-4 sm:px-6 py-3 text-gray-500">{i + 1}</td>
                  <td className="px-2 py-3 text-white font-medium">
                    <Link href={row.href} className="hover:underline hover:text-cyan-300">
                      {row.primary}
                    </Link>
                  </td>
                  <td className="px-2 py-3 text-gray-400">{row.secondary}</td>
                  <td className="px-2 py-3 text-right font-mono text-cyan-300">
                    {row.skillConservative.toFixed(3)}
                  </td>
                  <td className={`px-2 py-3 text-right font-mono font-semibold ${brierTone(row.brierScore)}`}>
                    {row.brierScore.toFixed(3)}
                  </td>
                  <td className="px-4 sm:px-6 py-3 text-right text-gray-500">{row.predictions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-600 mt-4 max-w-2xl">{t('footnote')}</p>
    </div>
  )
}
