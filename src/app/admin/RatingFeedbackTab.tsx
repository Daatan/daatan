'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw } from 'lucide-react'
import { sortRows } from './OracleTab'

interface Vote {
  id: string
  createdAt: string
  rating: number
  raterName: string | null
  raterUser: { id: string; name: string | null; username: string | null } | null
  flaggedFields: string[]
  note: string | null
  article: { title: string | null; url: string; source: string | null }
  prediction: { id: string; claimText: string; slug: string | null }
  snapshotSimilarity: number | null
  oracle: { mean: number | null; ciLow: number | null; ciHigh: number | null; articlesUsed: number | null } | null
}

interface RaterBreakdown {
  raterName: string
  count: number
  avgRating: number
  nonFiveCount: number
}

interface RatingFeedbackStats {
  promptsSent: number
  totalVotes: number
  responseRate: number
  ratingDistribution: number[]
  byRater: RaterBreakdown[]
  votes: Vote[]
}

type SortDir = 'asc' | 'desc'
type SortState = { key: string; dir: SortDir }

function useTableSort(defaultKey: string, defaultDir: SortDir = 'desc') {
  const [sort, setSort] = useState<SortState>({ key: defaultKey, dir: defaultDir })
  const toggle = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  return { sort, toggle }
}

function SortHeader({
  label, sortKey, sort, onSort, align = 'left',
}: {
  label: string
  sortKey: string
  sort: SortState
  onSort: (k: string) => void
  align?: 'left' | 'right'
}) {
  const active = sort.key === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`py-2 pr-4 font-medium cursor-pointer select-none hover:text-gray-700 ${align === 'right' ? 'text-right' : ''}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label}
        <span className={`text-[10px] ${active ? 'text-blue-400' : 'text-transparent'}`}>
          {active && sort.dir === 'asc' ? '▲' : '▼'}
        </span>
      </span>
    </th>
  )
}

function forecastHref(prediction: { id: string; slug: string | null }): string {
  return `/forecasts/${prediction.slug || prediction.id}`
}

const VOTE_GETTERS: Record<string, (v: Vote) => unknown> = {
  createdAt: (v) => v.createdAt,
  rater: (v) => v.raterName ?? v.raterUser?.name ?? v.raterUser?.username ?? null,
  rating: (v) => v.rating,
  article: (v) => v.article.title,
  prediction: (v) => v.prediction.claimText,
}

function VotesTable({ votes }: { votes: Vote[] }) {
  const { sort, toggle } = useTableSort('createdAt')
  const [nonFiveOnly, setNonFiveOnly] = useState(false)
  const filtered = nonFiveOnly ? votes.filter((v) => v.rating !== 5) : votes
  const sorted = sortRows(filtered, VOTE_GETTERS[sort.key], sort.dir)

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-700">Votes ({filtered.length})</h3>
        <label className="flex items-center gap-1.5 text-sm text-gray-500 cursor-pointer">
          <input type="checkbox" checked={nonFiveOnly} onChange={(e) => setNonFiveOnly(e.target.checked)} />
          Non-5 only
        </label>
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400">No votes recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <SortHeader label="Date" sortKey="createdAt" sort={sort} onSort={toggle} />
                <SortHeader label="Rater" sortKey="rater" sort={sort} onSort={toggle} />
                <SortHeader label="★" sortKey="rating" sort={sort} onSort={toggle} align="right" />
                <SortHeader label="Article" sortKey="article" sort={sort} onSort={toggle} />
                <SortHeader label="Prediction" sortKey="prediction" sort={sort} onSort={toggle} />
                <th className="py-2 pr-4 font-medium">Oracle</th>
                <th className="py-2 pr-4 font-medium">Flagged</th>
                <th className="py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((v) => (
                <tr key={v.id} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{new Date(v.createdAt).toLocaleString()}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{v.raterName ?? v.raterUser?.name ?? v.raterUser?.username ?? 'Unknown'}</td>
                  <td className={`py-2 pr-4 text-right tabular-nums font-bold ${v.rating <= 2 ? 'text-red-400' : v.rating === 3 ? 'text-amber-400' : 'text-green-400'}`}>
                    {v.rating}
                  </td>
                  <td className="py-2 pr-4 max-w-[240px]">
                    <a href={v.article.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline">
                      {v.article.title || v.article.url}
                    </a>
                    {v.article.source && <span className="text-gray-500"> — {v.article.source}</span>}
                    {v.snapshotSimilarity != null && (
                      <div className="text-xs text-gray-500">match {Math.round(v.snapshotSimilarity * 100)}%</div>
                    )}
                  </td>
                  <td className="py-2 pr-4 max-w-[240px]">
                    <Link href={forecastHref(v.prediction)} className="text-blue-400 hover:text-blue-300 underline">
                      {v.prediction.claimText}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap tabular-nums text-gray-500">
                    {v.oracle?.mean != null ? (
                      <>
                        {v.oracle.mean}%
                        {v.oracle.ciLow != null && v.oracle.ciHigh != null && (
                          <span className="text-xs"> ({v.oracle.ciLow}–{v.oracle.ciHigh})</span>
                        )}
                      </>
                    ) : '—'}
                  </td>
                  <td className="py-2 pr-4">
                    {v.flaggedFields.length > 0 ? v.flaggedFields.join(', ') : '—'}
                  </td>
                  <td className="py-2 max-w-[200px] text-gray-400">{v.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default function RatingFeedbackTab() {
  const [stats, setStats] = useState<RatingFeedbackStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchStats = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch('/api/admin/rating-feedback')
      if (res.ok) setStats(await res.json())
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Rating Feedback</h2>
        <button onClick={fetchStats} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-gray-400" size={24} />
        </div>
      ) : !stats ? (
        <p className="text-gray-500 text-sm">Failed to load rating feedback.</p>
      ) : (
        <>
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 border border-navy-600 rounded-lg bg-navy-700">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Prompts sent</div>
              <div className="text-xl font-bold tabular-nums">{stats.promptsSent}</div>
            </div>
            <div className="p-3 border border-navy-600 rounded-lg bg-navy-700">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Votes</div>
              <div className="text-xl font-bold tabular-nums">{stats.totalVotes}</div>
            </div>
            <div className="p-3 border border-navy-600 rounded-lg bg-navy-700">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Response rate</div>
              <div className="text-xl font-bold tabular-nums">{stats.responseRate}%</div>
            </div>
            <div className="p-3 border border-navy-600 rounded-lg bg-navy-700">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Distribution (1★→5★)</div>
              <div className="text-sm font-bold tabular-nums">{stats.ratingDistribution.join(' · ')}</div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-medium text-gray-700 mb-2">By rater</h3>
            {stats.byRater.length === 0 ? (
              <p className="text-sm text-gray-400">No votes recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2 pr-6 font-medium">Rater</th>
                      <th className="py-2 pr-6 font-medium text-right">Votes</th>
                      <th className="py-2 pr-6 font-medium text-right">Avg rating</th>
                      <th className="py-2 font-medium text-right">Non-5</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byRater.map((r) => (
                      <tr key={r.raterName} className="border-b last:border-0">
                        <td className="py-2 pr-6">{r.raterName}</td>
                        <td className="py-2 pr-6 text-right tabular-nums">{r.count}</td>
                        <td className="py-2 pr-6 text-right tabular-nums">{r.avgRating}</td>
                        <td className="py-2 text-right tabular-nums">{r.nonFiveCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <VotesTable votes={stats.votes} />
        </>
      )}
    </div>
  )
}
