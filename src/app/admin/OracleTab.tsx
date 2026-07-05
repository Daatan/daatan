'use client'
import { useState, useEffect, useCallback } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useCapabilities } from '@/components/CapabilitiesProvider'

type Breakdown = {
  key: string
  callCount: number
  errorCount: number
  avgDurationMs: number | null
  lastSeenAt: string | null
}

type RecentCall = {
  id: string
  callType: string
  source: string
  status: string
  httpStatus: number | null
  searchEngine: string | null
  provider: string | null
  providerChain: string[]
  query: string | null
  resultCount: number | null
  durationMs: number
  createdAt: string
  failureReason: string | null
  fellBackToLlm: boolean
  fallbackProbability: number | null
  user: { id: string; name: string | null; username: string | null } | null
  prediction: { id: string; slug: string | null; claimText: string } | null
}

type OracleStats = {
  windowDays: number
  totals: { totalCalls: number; errorCalls: number; errorRate: number; avgDurationMs: number | null }
  bySource: Breakdown[]
  byCallType: Breakdown[]
  byEngine: Breakdown[]
  byStatus: { key: string; callCount: number }[]
  byFailureReason: { key: string; callCount: number }[]
  fallback: { count: number; rate: number; avgProbability: number | null; extremeCount: number }
  recent: RecentCall[]
}

const WINDOW_OPTIONS = [1, 7, 30]

// Known workflows (OracleCallMeta source) and call types, for the filter dropdowns.
const SOURCE_OPTIONS = [
  'context-update', 'research', 'bot-voting', 'express-creation', 'express-guess',
  'multilingual-search', 'ibi-search', 'ibi-llm', 'ibi-fetch-url',
  'health-cron', 'leaderboard', 'news-indexer', 'other',
]
const CALLTYPE_OPTIONS = ['SEARCH', 'FORECAST', 'LEADERBOARD', 'HEALTH', 'SEARCH_HEALTH', 'LLM', 'FETCH_URL']
const STATUS_OPTIONS = ['OK', 'EMPTY', 'ERROR']

function statusClass(status: string): string {
  if (status === 'OK') return 'text-green-400'
  if (status === 'ERROR') return 'text-red-400'
  return 'text-amber-400' // EMPTY
}

// --- Client-side column sorting -------------------------------------------

type SortDir = 'asc' | 'desc'
type SortState = { key: string; dir: SortDir }

/** Stable-ish sort by an extracted value; nulls always sort last. */
export function sortRows<T>(rows: T[], get: (r: T) => unknown, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((ra, rb) => {
    const a = get(ra)
    const b = get(rb)
    if (a == null && b == null) return 0
    if (a == null) return 1
    if (b == null) return -1
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * sign
    return String(a).localeCompare(String(b)) * sign
  })
}

function useTableSort(defaultKey: string, defaultDir: SortDir = 'desc') {
  const [sort, setSort] = useState<SortState>({ key: defaultKey, dir: defaultDir })
  const toggle = (key: string) =>
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  return { sort, toggle }
}

function SortHeader({
  label, sortKey, sort, onSort, align = 'left', padCls = 'pr-4', title,
}: {
  label: string
  sortKey: string
  sort: SortState
  onSort: (k: string) => void
  align?: 'left' | 'right'
  padCls?: string
  title?: string
}) {
  const active = sort.key === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      title={title}
      className={`py-2 ${padCls} font-medium cursor-pointer select-none hover:text-gray-700 ${align === 'right' ? 'text-right' : ''} ${title ? 'underline decoration-dotted decoration-gray-500 underline-offset-4' : ''}`}
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

const BREAKDOWN_GETTERS: Record<string, (r: Breakdown) => unknown> = {
  key: r => r.key,
  callCount: r => r.callCount,
  errorCount: r => r.errorCount,
  avgDurationMs: r => r.avgDurationMs,
  lastSeenAt: r => r.lastSeenAt,
}

function BreakdownTable({ title, label, rows }: { title: string; label: string; rows: Breakdown[] }) {
  const { sort, toggle } = useTableSort('callCount')
  const sorted = sortRows(rows, BREAKDOWN_GETTERS[sort.key], sort.dir)
  return (
    <section>
      <h3 className="text-sm font-medium text-gray-700 mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">No calls recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <SortHeader label={label} sortKey="key" sort={sort} onSort={toggle} padCls="pr-6" />
                <SortHeader label="Calls" sortKey="callCount" sort={sort} onSort={toggle} align="right" padCls="pr-6" />
                <SortHeader label="Errors" sortKey="errorCount" sort={sort} onSort={toggle} align="right" padCls="pr-6" />
                <SortHeader label="Avg duration" sortKey="avgDurationMs" sort={sort} onSort={toggle} align="right" padCls="pr-6" />
                <SortHeader label="Last seen" sortKey="lastSeenAt" sort={sort} onSort={toggle} padCls="" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => (
                <tr key={row.key} className="border-b last:border-0">
                  <td className="py-2 pr-6 font-mono">{row.key}</td>
                  <td className="py-2 pr-6 text-right tabular-nums">{row.callCount}</td>
                  <td className="py-2 pr-6 text-right tabular-nums">
                    {row.errorCount > 0 ? <span className="text-red-400">{row.errorCount}</span> : '0'}
                  </td>
                  <td className="py-2 pr-6 text-right tabular-nums">
                    {row.avgDurationMs != null ? `${row.avgDurationMs} ms` : '—'}
                  </td>
                  <td className="py-2 text-gray-500">
                    {row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function FailuresAndFallback({
  byFailureReason,
  fallback,
}: {
  byFailureReason: { key: string; callCount: number }[]
  fallback: { count: number; rate: number; avgProbability: number | null; extremeCount: number }
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-gray-700">Failures &amp; fallback</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 border border-navy-600 rounded-lg bg-navy-700">
          <div className="text-xs text-gray-400 uppercase tracking-wide">LLM fallbacks</div>
          <div className="text-xl font-bold tabular-nums">{fallback.count}</div>
        </div>
        <div className="p-3 border border-navy-600 rounded-lg bg-navy-700">
          <div className="text-xs text-gray-400 uppercase tracking-wide">Fallback rate</div>
          <div className="text-xl font-bold tabular-nums" title="Share of FORECAST calls that fell back to the LLM">{fallback.rate}%</div>
        </div>
        <div className="p-3 border border-navy-600 rounded-lg bg-navy-700">
          <div className="text-xs text-gray-400 uppercase tracking-wide">Avg fallback prob.</div>
          <div className="text-xl font-bold tabular-nums">
            {fallback.avgProbability != null ? `${fallback.avgProbability}%` : '—'}
          </div>
        </div>
        <div className="p-3 border border-navy-600 rounded-lg bg-navy-700">
          <div className="text-xs text-gray-400 uppercase tracking-wide" title="Fallbacks above 85% or below 10%">Extreme fallbacks</div>
          <div className="text-xl font-bold tabular-nums text-red-400">{fallback.extremeCount}</div>
        </div>
      </div>
      {byFailureReason.length === 0 ? (
        <p className="text-sm text-gray-400">No failures recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-2 pr-6 font-medium">Failure reason</th>
                <th className="py-2 font-medium text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {byFailureReason.map(row => (
                <tr key={row.key} className="border-b last:border-0">
                  <td className="py-2 pr-6 font-mono">{row.key}</td>
                  <td className="py-2 text-right tabular-nums">{row.callCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

const RECENT_GETTERS: Record<string, (e: RecentCall) => unknown> = {
  createdAt: e => e.createdAt,
  callType: e => e.callType,
  source: e => e.source,
  status: e => e.status,
  failureReason: e => e.failureReason,
  searchEngine: e => e.searchEngine,
  provider: e => e.provider,
  // Fallbacks sort by probability; non-fallback rows sort last (null).
  fallback: e => (e.fellBackToLlm ? (e.fallbackProbability ?? 0) : null),
  user: e => e.user?.username ?? e.user?.name ?? null,
  resultCount: e => e.resultCount,
  durationMs: e => e.durationMs,
  query: e => e.query,
  prediction: e => e.prediction?.claimText ?? null,
}

// Human-readable hints for the failureReason codes stored on OracleCallLog,
// surfaced as a per-row tooltip in the recent-calls table.
const FAILURE_REASON_HINTS: Record<string, string> = {
  timeout: 'The Oracle did not respond within the request timeout.',
  oracle_timeout: 'The Oracle did not respond within the request timeout.',
  network: 'Network/transport error reaching the Oracle.',
  http_4xx: 'The Oracle returned a 4xx client error.',
  http_5xx: 'The Oracle returned a 5xx server error.',
  no_search_results: 'The search returned zero articles.',
  insufficient_data: 'Not enough articles for a real estimate (placeholder returned).',
  placeholder: 'The Oracle returned a placeholder rather than a real estimate.',
}

export function failureReasonTitle(reason: string): string {
  return FAILURE_REASON_HINTS[reason] ?? 'Failure/empty reason reported by the Oracle.'
}

/** "dataforseo → gdelt → caller" — the ordered providers attempted. */
export function formatProviderChain(chain: string[]): string {
  return chain.length > 0 ? chain.join(' → ') : ''
}

// Column-header tooltips that make the Oracle vocabulary self-explanatory.
const HEADER_HINTS = {
  type: 'Oracle call type — FORECAST: AI probability estimate; SEARCH: article retrieval; LEADERBOARD/HEALTH/LLM/FETCH_URL: support calls.',
  source: 'Daatan workflow that triggered this Oracle call (e.g. context-update, research, express-creation).',
  status: 'OK: usable result · EMPTY: no usable result (see Detail) · ERROR: call failed (see Detail).',
  detail: 'Why a call was EMPTY or ERROR — hover a row for the specific reason.',
  engine: 'Search engine that ultimately served the result. "caller" = articles supplied directly by the caller (no search); "none" = no provider claimed it.',
  provider: 'Provider that served the result; hover a row for the full provider chain attempted.',
  fallback: 'Whether a FORECAST fell back to the LLM (with its probability) instead of an article-grounded estimate.',
  by: 'The caller that triggered the Oracle call.',
} as const

function RecentCallsTable({ rows }: { rows: RecentCall[] }) {
  const { sort, toggle } = useTableSort('createdAt')
  const sorted = sortRows(rows, RECENT_GETTERS[sort.key], sort.dir)
  return (
    <section>
      <h3 className="text-sm font-medium text-gray-700 mb-2">Recent calls (last 50)</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">No calls recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <SortHeader label="Time" sortKey="createdAt" sort={sort} onSort={toggle} />
                <SortHeader label="Type" sortKey="callType" sort={sort} onSort={toggle} title={HEADER_HINTS.type} />
                <SortHeader label="Source" sortKey="source" sort={sort} onSort={toggle} title={HEADER_HINTS.source} />
                <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} title={HEADER_HINTS.status} />
                <SortHeader label="Detail" sortKey="failureReason" sort={sort} onSort={toggle} title={HEADER_HINTS.detail} />
                <SortHeader label="Engine" sortKey="searchEngine" sort={sort} onSort={toggle} title={HEADER_HINTS.engine} />
                <SortHeader label="Provider" sortKey="provider" sort={sort} onSort={toggle} title={HEADER_HINTS.provider} />
                <SortHeader label="Fallback" sortKey="fallback" sort={sort} onSort={toggle} title={HEADER_HINTS.fallback} />
                <SortHeader label="By" sortKey="user" sort={sort} onSort={toggle} title={HEADER_HINTS.by} />
                <SortHeader label="Results" sortKey="resultCount" sort={sort} onSort={toggle} align="right" />
                <SortHeader label="Duration" sortKey="durationMs" sort={sort} onSort={toggle} align="right" />
                <SortHeader label="Query" sortKey="query" sort={sort} onSort={toggle} />
                <SortHeader label="Forecast" sortKey="prediction" sort={sort} onSort={toggle} padCls="" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(entry => (
                <tr key={entry.id} className="border-b last:border-0 align-top">
                  <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td>
                  <td className="py-2 pr-4 font-mono whitespace-nowrap">{entry.callType}</td>
                  <td className="py-2 pr-4 font-mono whitespace-nowrap">{entry.source}</td>
                  <td className={`py-2 pr-4 font-mono whitespace-nowrap ${statusClass(entry.status)}`}>
                    {entry.status}{entry.httpStatus != null ? ` (${entry.httpStatus})` : ''}
                  </td>
                  <td className="py-2 pr-4 font-mono text-gray-400 max-w-[12rem] truncate">
                    {entry.failureReason ? (
                      <span className="text-amber-400" title={failureReasonTitle(entry.failureReason)}>{entry.failureReason}</span>
                    ) : '—'}
                  </td>
                  <td className="py-2 pr-4 font-mono text-gray-400 whitespace-nowrap">{entry.searchEngine ?? '—'}</td>
                  <td
                    className="py-2 pr-4 font-mono text-gray-400 whitespace-nowrap"
                    title={entry.providerChain.length > 0 ? `chain: ${formatProviderChain(entry.providerChain)}` : undefined}
                  >
                    {entry.provider ?? '—'}
                    {entry.providerChain.length > 1 ? <span className="text-gray-500"> (+{entry.providerChain.length - 1})</span> : null}
                  </td>
                  <td className="py-2 pr-4 font-mono whitespace-nowrap">
                    {entry.fellBackToLlm ? (
                      <span className="text-purple-400" title="FORECAST fell back to the LLM instead of an article-grounded estimate">
                        LLM{entry.fallbackProbability != null ? ` ${entry.fallbackProbability}%` : ''}
                      </span>
                    ) : <span className="text-gray-500">—</span>}
                  </td>
                  <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">
                    {entry.user ? (
                      <a href={`/profile/${entry.user.id}`} className="text-blue-500 hover:underline">
                        {entry.user.username ? `@${entry.user.username}` : entry.user.name || '—'}
                      </a>
                    ) : '—'}
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-right">{entry.resultCount ?? '—'}</td>
                  <td className="py-2 pr-4 tabular-nums text-right whitespace-nowrap">{entry.durationMs} ms</td>
                  <td className="py-2 pr-4 text-gray-600 max-w-xs truncate" title={entry.query ?? ''}>{entry.query ?? '—'}</td>
                  <td className="py-2 whitespace-nowrap">
                    {entry.prediction ? (
                      <a
                        href={`/forecasts/${entry.prediction.slug ?? entry.prediction.id}`}
                        className="text-blue-500 hover:underline"
                        title={entry.prediction.claimText}
                      >
                        ↗ open
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default function OracleTab() {
  const { selfHosted } = useCapabilities()
  // 'bot-voting' is a SaaS-only Oracle caller — drop it from the filter on self-host.
  const sourceOptions = selfHosted ? SOURCE_OPTIONS.filter(s => s !== 'bot-voting') : SOURCE_OPTIONS
  const [stats, setStats] = useState<OracleStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [windowDays, setWindowDays] = useState(30)
  const [source, setSource] = useState('')
  const [callType, setCallType] = useState('')
  const [status, setStatus] = useState('')

  const fetchStats = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ windowDays: String(windowDays) })
      if (source) params.set('source', source)
      if (callType) params.set('callType', callType)
      if (status) params.set('status', status)
      const res = await fetch(`/api/admin/oracle-stats?${params}`)
      if (res.ok) setStats(await res.json())
    } finally {
      setIsLoading(false)
    }
  }, [windowDays, source, callType, status])

  useEffect(() => { fetchStats() }, [fetchStats])

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold">Oracle Usage</h2>
        <div className="flex items-center gap-3">
          <select
            value={windowDays}
            onChange={e => setWindowDays(Number(e.target.value))}
            aria-label="Filter by time window"
            className="border border-navy-600 bg-navy-700 rounded p-1 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          >
            {WINDOW_OPTIONS.map(d => (
              <option key={d} value={d}>Last {d} {d === 1 ? 'day' : 'days'}</option>
            ))}
          </select>
          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            className="border border-navy-600 bg-navy-700 rounded p-1 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            title="Filter by source workflow"
            aria-label="Filter by source workflow"
          >
            <option value="">All sources</option>
            {sourceOptions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={callType}
            onChange={e => setCallType(e.target.value)}
            className="border border-navy-600 bg-navy-700 rounded p-1 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            title="Filter by call type"
            aria-label="Filter by call type"
          >
            <option value="">All types</option>
            {CALLTYPE_OPTIONS.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="border border-navy-600 bg-navy-700 rounded p-1 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            title="Filter by call status"
            aria-label="Filter by call status"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button onClick={fetchStats} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-gray-400" size={24} />
        </div>
      ) : !stats ? (
        <p className="text-gray-500 text-sm">Failed to load Oracle stats.</p>
      ) : (
        <>
          {/* Totals */}
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 border border-navy-600 rounded-lg bg-navy-700">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Total calls</div>
              <div className="text-xl font-bold tabular-nums">{stats.totals.totalCalls}</div>
            </div>
            <div className="p-3 border border-navy-600 rounded-lg bg-navy-700">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Errors</div>
              <div className="text-xl font-bold tabular-nums text-red-400">{stats.totals.errorCalls}</div>
            </div>
            <div className="p-3 border border-navy-600 rounded-lg bg-navy-700">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Error rate</div>
              <div className="text-xl font-bold tabular-nums">{stats.totals.errorRate}%</div>
            </div>
            <div className="p-3 border border-navy-600 rounded-lg bg-navy-700">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Avg duration</div>
              <div className="text-xl font-bold tabular-nums">
                {stats.totals.avgDurationMs != null ? `${stats.totals.avgDurationMs} ms` : '—'}
              </div>
            </div>
          </section>

          <BreakdownTable title="By source" label="Source" rows={stats.bySource} />
          <BreakdownTable title="By call type" label="Call type" rows={stats.byCallType} />
          <BreakdownTable title="By search engine" label="Engine" rows={stats.byEngine} />

          <FailuresAndFallback byFailureReason={stats.byFailureReason} fallback={stats.fallback} />

          <RecentCallsTable rows={stats.recent} />
        </>
      )}
    </div>
  )
}
