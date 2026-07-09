'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw, ExternalLink, ArrowUpDown, ArrowDown } from 'lucide-react'
import { useTranslations } from 'next-intl'

type Impact = {
  matches: number
  forecastsAffected: number
  last30dMatches: number
  lastMatchedAt: string | null
  sharedWith?: string | null
}

type Source = {
  type: string
  name: string | null
  locator: string | null
  language: string | null
  enabled: boolean
  disabledReason?: string | null
  domain?: string | null
  impact?: Impact
}

type Unconfigured = { domain: string } & Impact

type SourcesResponse = {
  sources: Source[]
  total: number
  enabled: number
  unconfigured?: Unconfigured[]
}

const TYPE_ORDER = ['rss', 'youtube', 'telegram', 'x']
const ZERO_IMPACT: Impact = { matches: 0, forecastsAffected: 0, last30dMatches: 0, lastMatchedAt: null }

function isUrl(s: string | null): s is string {
  return !!s && /^https?:\/\//.test(s)
}

const impactOf = (s: Source): Impact => s.impact ?? ZERO_IMPACT

export default function SourcesTab() {
  const t = useTranslations('admin')
  const [data, setData] = useState<SourcesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortImpact, setSortImpact] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/news-indexer/sources', { cache: 'no-store' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Request failed (${res.status})`)
      }
      setData(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sources')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const types = data
    ? [...TYPE_ORDER.filter((ty) => data.sources.some((s) => s.type === ty)),
       ...[...new Set(data.sources.map((s) => s.type))].filter((ty) => !TYPE_ORDER.includes(ty))]
    : []

  const unconfigured = data?.unconfigured ?? []

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">{t('sourcesTitle')}</h2>
          {data && (
            <p className="text-sm text-gray-400">
              {t('sourcesSummary', { enabled: data.enabled, total: data.total })}
            </p>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-cobalt/10 hover:bg-blue-100 rounded-md transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {t('refresh')}
        </button>
      </div>

      {error && (
        <div className="p-3 mb-4 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-blue-500 animate-spin" /></div>
      ) : (
        <>
          {types.map((ty) => {
            const base = data!.sources.filter((s) => s.type === ty)
            const rows = sortImpact
              ? [...base].sort((a, b) =>
                  impactOf(b).forecastsAffected - impactOf(a).forecastsAffected ||
                  impactOf(b).matches - impactOf(a).matches)
              : base
            return (
              <div key={ty} className="mb-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                  {ty} ({rows.filter((r) => r.enabled).length}/{rows.length})
                </h3>
                <div className="overflow-x-auto rounded-lg border border-navy-600">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-navy-800 text-gray-400 text-left text-xs uppercase tracking-wide">
                        <th className="px-3 py-2 font-medium">{t('sourcesName')}</th>
                        <th className="px-3 py-2 font-medium">{t('sourcesLang')}</th>
                        <th className="px-3 py-2 font-medium">{t('sourcesStatus')}</th>
                        <th className="px-3 py-2 font-medium">
                          <button
                            onClick={() => setSortImpact((v) => !v)}
                            className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-200 transition-colors"
                            title={t('sourcesImpact')}
                          >
                            {t('sourcesImpact')}
                            {sortImpact ? <ArrowDown className="w-3 h-3" /> : <ArrowUpDown className="w-3 h-3 opacity-60" />}
                          </button>
                        </th>
                        <th className="px-3 py-2 font-medium">{t('sourcesLocator')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((s, i) => {
                        const imp = impactOf(s)
                        const measurable = !!s.domain
                        const shared = imp.sharedWith
                        const dim = measurable && !shared && imp.forecastsAffected === 0
                        return (
                          <tr key={`${s.name}-${i}`} className={`border-t border-navy-700 ${dim ? 'opacity-50' : ''}`}>
                            <td className="px-3 py-2 font-medium text-white">
                              {s.name ? (
                                <Link href={`/admin/sources/${encodeURIComponent(s.name)}`} className="hover:text-blue-400 hover:underline transition-colors">
                                  {s.name}
                                </Link>
                              ) : '—'}
                            </td>
                            <td className="px-3 py-2 text-gray-400 uppercase">{s.language || '—'}</td>
                            <td className="px-3 py-2 max-w-[18rem]">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                                s.enabled
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-gray-500/15 text-gray-400 border border-gray-500/30'
                              }`}>
                                {s.enabled ? t('sourcesEnabled') : t('sourcesDisabled')}
                              </span>
                              {!s.enabled && s.disabledReason && (
                                <p className="mt-1 text-[11px] text-gray-500 leading-snug" title={s.disabledReason}>
                                  {s.disabledReason}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {shared ? (
                                <span className="text-[11px] text-gray-500 italic">
                                  {t('sourcesSharedWith', { name: shared })}
                                </span>
                              ) : measurable ? (
                                <span className="inline-flex items-baseline gap-1.5">
                                  <span className={`font-bold ${imp.forecastsAffected > 0 ? 'text-white' : 'text-gray-500'}`}>
                                    {imp.forecastsAffected}
                                  </span>
                                  {imp.last30dMatches > 0 && (
                                    <span className="text-[11px] text-emerald-400">
                                      {t('sourcesImpact30d', { count: imp.last30dMatches })}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-gray-600">{t('sourcesImpactNa')}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-gray-400 max-w-[22rem] truncate">
                              {isUrl(s.locator) ? (
                                <a href={s.locator} target="_blank" rel="noopener noreferrer"
                                   className="inline-flex items-center gap-1 text-blue-500 hover:underline">
                                  {s.locator}<ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              ) : (s.locator || '—')}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}

          {unconfigured.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">
                {t('sourcesSuggestedTitle')} ({unconfigured.length})
              </h3>
              <p className="text-xs text-gray-500 mb-2 max-w-2xl">{t('sourcesSuggestedHint')}</p>
              <div className="overflow-x-auto rounded-lg border border-amber-500/20">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-amber-500/5 text-amber-200/70 text-left text-xs uppercase tracking-wide">
                      <th className="px-3 py-2 font-medium">{t('sourcesDomain')}</th>
                      <th className="px-3 py-2 font-medium">{t('sourcesSuggestedForecasts')}</th>
                      <th className="px-3 py-2 font-medium">{t('sourcesSuggestedMatches')}</th>
                      <th className="px-3 py-2 font-medium">{t('sourcesImpact')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unconfigured.map((u) => (
                      <tr key={u.domain} className="border-t border-navy-700">
                        <td className="px-3 py-2 font-medium text-white">
                          <a href={`https://${u.domain}`} target="_blank" rel="noopener noreferrer"
                             className="inline-flex items-center gap-1 text-blue-500 hover:underline">
                            {u.domain}<ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        </td>
                        <td className="px-3 py-2 font-bold text-white">{u.forecastsAffected}</td>
                        <td className="px-3 py-2 text-gray-400">{u.matches}</td>
                        <td className="px-3 py-2 text-[11px] text-emerald-400">
                          {u.last30dMatches > 0 ? t('sourcesImpact30d', { count: u.last30dMatches }) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
