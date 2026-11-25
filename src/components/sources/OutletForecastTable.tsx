'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import {
  DEFAULT_SORT_DIR, MIN_TREND_ARTICLES, sortOutletForecasts,
  type OutletForecastRow, type OutletForecastSort, type OutletForecastState, type SortDir,
} from '@/lib/utils/outlet-forecasts'

/** Rows shown before "show all": enough to read the outlet, short enough to reach the articles. */
export const INITIAL_ROWS = 20

const COLUMNS: { key: OutletForecastSort | null; label: string; className: string }[] = [
  { key: 'title', label: 'colForecast', className: 'text-start' },
  { key: 'lean', label: 'colLean', className: 'text-start w-40' },
  { key: null, label: 'colTrend', className: 'text-start w-24' },
  { key: 'articles', label: 'colArticles', className: 'text-end w-20' },
  { key: 'lastArticle', label: 'colLastArticle', className: 'text-start w-32' },
  { key: 'state', label: 'colOutcome', className: 'text-start w-32' },
]

const MOBILE_SORTS: OutletForecastSort[] = ['default', 'lastArticle', 'lean', 'articles', 'title', 'state']

const STATE_STYLE: Record<OutletForecastState, string> = {
  open: 'text-gray-400',
  pending: 'text-amber-300',
  cameTrue: 'px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300',
  didNotHappen: 'px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300',
  annulled: 'px-1.5 py-0.5 rounded bg-navy-800 border border-navy-600 text-gray-400',
}

const STATE_LABEL: Record<OutletForecastState, string> = {
  open: 'statusOpen',
  pending: 'statusPending',
  cameTrue: 'outcomeYes',
  didNotHappen: 'outcomeNo',
  annulled: 'outcomeAnnulled',
}

function leanTone(lean: number): string {
  if (lean > 55) return 'bg-emerald-400'
  if (lean < 45) return 'bg-rose-400'
  return 'bg-gray-400'
}

function LeanBar({ lean }: { lean: number }) {
  return (
    <div className="flex items-center gap-2" dir="ltr">
      <div className="relative h-1.5 w-20 rounded-full bg-navy-800 border border-navy-600 overflow-hidden">
        <div className={`absolute inset-y-0 left-0 ${leanTone(lean)}`} style={{ width: `${lean}%` }} />
        <div className="absolute inset-y-0 left-1/2 w-px bg-gray-500" aria-hidden="true" />
      </div>
      <span className="font-mono text-sm text-white tabular-nums">{lean}%</span>
    </div>
  )
}

const W = 72
const H = 22

/** The outlet's running lean, article by article; one dot when there are too few articles for a line. */
function Trend({ row, title }: { row: OutletForecastRow; title: string }) {
  const y = (v: number) => 2 + ((100 - v) / 100) * (H - 4)
  const points = row.trend
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="overflow-visible">
      <title>{title}</title>
      <line x1={0} x2={W} y1={y(50)} y2={y(50)} className="stroke-navy-600" strokeDasharray="2 2" />
      {row.articles < MIN_TREND_ARTICLES || points.length < 2 ? (
        <circle cx={W / 2} cy={y(row.lean)} r={2.5} className="fill-cyan-400" />
      ) : (
        <polyline
          fill="none"
          className="stroke-cyan-400"
          strokeWidth={1.5}
          strokeLinejoin="round"
          points={points.map((v, i) => `${((i / (points.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
        />
      )}
    </svg>
  )
}

export default function OutletForecastTable({ rows }: { rows: OutletForecastRow[] }) {
  const t = useTranslations('outletPage')
  const locale = useLocale()
  const [sort, setSort] = useState<OutletForecastSort>('default')
  const [dir, setDir] = useState<SortDir>(DEFAULT_SORT_DIR.default)
  const [showAll, setShowAll] = useState(false)

  const sorted = sortOutletForecasts(rows, sort, dir)
  const shown = showAll ? sorted : sorted.slice(0, INITIAL_ROWS)
  const date = (day: string) =>
    new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' })
  const trendTitle = (r: OutletForecastRow) =>
    t('trendTitle', { count: r.articles, first: r.trend[0], last: r.lean })

  const sortBy = (key: OutletForecastSort) => {
    if (key === sort) {
      setDir(dir === 'asc' ? 'desc' : 'asc')
    } else {
      setSort(key)
      setDir(DEFAULT_SORT_DIR[key])
    }
  }

  const outcome = (state: OutletForecastState) => (
    <span className={`text-xs whitespace-nowrap ${STATE_STYLE[state]}`}>{t(STATE_LABEL[state])}</span>
  )

  return (
    <div>
      <label className="sm:hidden flex items-center gap-2 mb-3 text-xs text-gray-400">
        {t('sortBy')}
        <select
          value={sort}
          onChange={(e) => {
            const key = e.target.value as OutletForecastSort
            setSort(key)
            setDir(DEFAULT_SORT_DIR[key])
          }}
          className="bg-navy-800 border border-navy-600 rounded-md px-2 py-1 text-sm text-white"
        >
          {MOBILE_SORTS.map((key) => (
            <option key={key} value={key}>{t(`sort.${key}`)}</option>
          ))}
        </select>
      </label>

      <ul className="sm:hidden rounded-lg border border-navy-600 divide-y divide-navy-700">
        {shown.map((r) => (
          <li key={r.forecastId} className="px-3 py-3">
            <Link href={r.href} dir="auto" className="block text-sm text-white hover:underline hover:text-cyan-300 break-words">
              {r.title}
            </Link>
            <div className="mt-2 flex items-center gap-3">
              <LeanBar lean={r.lean} />
              <Trend row={r} title={trendTitle(r)} />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
              <span>{t('articleCount', { count: r.articles })}</span>
              <span aria-hidden="true">·</span>
              <time dateTime={r.lastArticle}>{date(r.lastArticle)}</time>
              <span aria-hidden="true">·</span>
              {outcome(r.state)}
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden sm:block overflow-x-auto rounded-lg border border-navy-600">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-navy-800 border-b border-navy-600">
              {COLUMNS.map((c) => {
                const active = c.key !== null && c.key === sort
                return (
                  <th
                    key={c.label}
                    aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : c.key ? 'none' : undefined}
                    className={`px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider ${c.className} ${active ? 'text-white' : 'text-gray-500'}`}
                  >
                    {c.key ? (
                      <button type="button" onClick={() => sortBy(c.key!)} className="uppercase tracking-wider hover:text-white transition-colors">
                        {t(c.label)}
                        {active && <span aria-hidden="true">{dir === 'asc' ? ' ↑' : ' ↓'}</span>}
                      </button>
                    ) : (
                      t(c.label)
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-700">
            {shown.map((r) => (
              <tr key={r.forecastId} className="hover:bg-navy-800/50">
                <td className="px-3 py-2.5">
                  <Link href={r.href} dir="auto" className="text-white hover:underline hover:text-cyan-300 break-words">
                    {r.title}
                  </Link>
                </td>
                <td className="px-3 py-2.5"><LeanBar lean={r.lean} /></td>
                <td className="px-3 py-2.5"><Trend row={r} title={trendTitle(r)} /></td>
                <td className="px-3 py-2.5 text-end text-gray-400 tabular-nums">{r.articles}</td>
                <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap">
                  <time dateTime={r.lastArticle}>{date(r.lastArticle)}</time>
                </td>
                <td className="px-3 py-2.5">{outcome(r.state)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!showAll && sorted.length > INITIAL_ROWS && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 text-sm text-cyan-400 hover:underline"
        >
          {t('showAllForecasts', { count: sorted.length })}
        </button>
      )}
    </div>
  )
}
