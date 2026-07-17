'use client'

import { useEffect, useState, useRef } from 'react'
import { FileText, RefreshCw, Loader2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useTranslations } from 'next-intl'
import { createClientLogger } from '@/lib/client-logger'
import { toError } from '@/lib/utils/error'
import { formatDisplayDateTime } from '@/lib/utils/date'
import { useCapabilities } from '@/components/CapabilitiesProvider'

const log = createClientLogger('ContextTimeline')

type Source = {
  title: string
  url: string
  source?: string | null
  publishedDate?: string | null
}

/** A source domain with how many distinct articles in this update came from it. */
type GroupedSource = { source: string; url: string; count: number }

/** Domain label for a source — its `source` field, else the URL host (sans www). */
function sourceDomain(src: Source): string {
  if (src.source) return src.source
  try {
    return new URL(src.url).hostname.replace(/^www\./, '')
  } catch {
    return src.title || src.url
  }
}

/**
 * Collapse an update's raw source list into one entry per domain, deduping
 * identical article URLs. Avoids the wall of repeated "aljazeera.com /
 * middleeasteye.net" chips when an update cites many articles from a few sources.
 */
export function groupSources(sources: Source[]): GroupedSource[] {
  const byDomain = new Map<string, { source: string; url: string; urls: Set<string> }>()
  for (const s of sources) {
    if (!s?.url) continue
    const key = sourceDomain(s)
    const existing = byDomain.get(key)
    if (existing) existing.urls.add(s.url)
    else byDomain.set(key, { source: key, url: s.url, urls: new Set([s.url]) })
  }
  return Array.from(byDomain.values()).map(e => ({
    source: e.source,
    url: e.url,
    count: e.urls.size,
  }))
}

/** Single source entry within an Oracle forecast snapshot (camelCase variant used in UI). */
type OracleSnapshotSource = {
  sourceId: string
  sourceName: string
  url: string
  /** [-1, 1] — negative favours NO, positive favours YES. */
  stance: number
  /** [0, 1] — how confident this source is. */
  certainty: number
  /** Leaderboard credibility weight; ~1.0 is neutral. */
  credibilityWeight: number
  claims: string[]
}

/** Full Oracle payload persisted alongside a context snapshot when the Oracle path is taken. */
type OracleSnapshot = {
  /** Probability percent [0, 100] — converted from the Oracle's raw stance mean. */
  mean: number
  /** Spread, on the same percent scale as `mean`/`ciLow`/`ciHigh`. */
  std: number
  ciLow: number
  ciHigh: number
  articlesUsed: number
  sources: OracleSnapshotSource[]
}

export type AiEstimate = {
  /** Null when the run abstained (see `abstained`). */
  probability: number | null
  ciLow?: number
  ciHigh?: number
  /** The Oracle had no evidence bearing on the claim — show "Insufficient evidence". */
  abstained?: boolean
}

export type Snapshot = {
  id: string
  summary: string
  sources: Source[]
  createdAt: string
  externalProbability?: number | null
  externalReasoning?: string | null
  oracleSnapshot?: OracleSnapshot | null
  insufficientData?: boolean
}

type NewsAnchor = {
  title: string
  url: string
  source?: string | null
}

type Props = {
  predictionId: string
  initialContext?: string | null
  initialContextUpdatedAt?: string | null
  /** Server-prefetched timeline; when present, skips the mount-time fetch and renders snapshots into SSR HTML. */
  initialSnapshots?: Snapshot[]
  canAnalyze: boolean
  newsAnchor?: NewsAnchor | null
  onAiEstimate?: (value: AiEstimate | null) => void
}

/** Map a snapshot's persisted probability + Oracle CI (if any) into the callback shape. */
const toAiEstimate = (snap: Snapshot | undefined): AiEstimate | null => {
  if (!snap) return null
  // The latest run abstained — surface "Insufficient evidence", not a stale number.
  if (snap.insufficientData) return { probability: null, abstained: true }
  if (snap.externalProbability == null) return null
  const oracle = snap.oracleSnapshot
  return {
    probability: snap.externalProbability,
    ciLow: oracle?.ciLow,
    ciHigh: oracle?.ciHigh,
  }
}

export default function ContextTimeline({
  predictionId,
  initialContext,
  initialContextUpdatedAt,
  initialSnapshots,
  canAnalyze,
  newsAnchor,
  onAiEstimate,
}: Props) {
  const hasInitialSnapshots = initialSnapshots != null
  const [currentContext, setCurrentContext] = useState(initialContext || null)
  const [contextUpdatedAt, setContextUpdatedAt] = useState(initialContextUpdatedAt || null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>(initialSnapshots ?? [])
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeStep, setAnalyzeStep] = useState<'searching' | 'analyzing' | 'estimating' | null>(null)
  const stepTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const [isContextOpen, setIsContextOpen] = useState(false)
  const [isTimelineOpen, setIsTimelineOpen] = useState(false)
  const [hasFetched, setHasFetched] = useState(hasInitialSnapshots)
  const { aiResearch } = useCapabilities()
  const t = useTranslations('context')

  const TIMING_KEY = 'daatan:context-timings'
  const TIMING_TTL_MS = 7 * 24 * 60 * 60 * 1000
  const DEFAULT_TIMINGS = { searchMs: 10_000, llmMs: 12_000, oracleMs: 8_000 }

  function loadTimings() {
    try {
      const raw = localStorage.getItem(TIMING_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        return {
          searchMs: parsed.searchMs ?? DEFAULT_TIMINGS.searchMs,
          llmMs: parsed.llmMs ?? DEFAULT_TIMINGS.llmMs,
          oracleMs: parsed.oracleMs ?? DEFAULT_TIMINGS.oracleMs,
        }
      }
    } catch { /* ignore */ }
    return DEFAULT_TIMINGS
  }

  function saveTimings(timings: { searchMs: number; llmMs: number; oracleMs: number }) {
    try {
      localStorage.setItem(TIMING_KEY, JSON.stringify({ ...timings, savedAt: Date.now() }))
    } catch { /* storage full or private mode */ }
  }

  // Fetch timeline on mount. Deliberately does NOT call onAiEstimate: on first
  // paint the gauge reads the prediction's funnel-maintained cache
  // (confidence/aiCiLow/aiCiHigh — includes the daily clock requote), which the
  // latest *evidence* snapshot here would shadow with a staler value. The
  // callback fires only from a fresh in-page analyze run (below).
  useEffect(() => {
    // Server already prefetched the timeline for SEO — skip the redundant fetch.
    if (hasInitialSnapshots) return
    const fetchTimeline = async () => {
      try {
        const res = await fetch(`/api/forecasts/${predictionId}/context`)
        if (res.ok) {
          const data = await res.json()
          setCurrentContext(data.currentContext)
          setContextUpdatedAt(data.contextUpdatedAt)
          setSnapshots(data.snapshots || [])
        }
      } catch (err) {
        log.error({ err }, 'Failed to fetch context timeline')
      } finally {
        setHasFetched(true)
      }
    }
    fetchTimeline()
  }, [predictionId, hasInitialSnapshots])

  // Seed localStorage from server averages when data is absent or stale
  useEffect(() => {
    const seedFromServer = async () => {
      try {
        const raw = localStorage.getItem(TIMING_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        const isStale = !parsed?.savedAt || Date.now() - parsed.savedAt > TIMING_TTL_MS
        if (!isStale) return
        const res = await fetch('/api/meta/timings')
        if (!res.ok) return
        const data = await res.json()
        if (data.hasData) saveTimings(data.timings)
      } catch { /* non-critical */ }
    }
    seedFromServer()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAnalyze = async () => {
    const timings = loadTimings()
    setIsAnalyzing(true)
    setAnalyzeStep('searching')
    toast.loading(t('stepSearching'), { id: 'analyze' })

    // Timer: searching → analyzing (search phase estimate; transitions to 'estimating'
    // are driven by the real 'summary' SSE event once the LLM finishes)
    stepTimers.current = [
      setTimeout(() => {
        setAnalyzeStep('analyzing')
        toast.loading(t('stepAnalyzing'), { id: 'analyze' })
      }, timings.searchMs),
    ]

    try {
      const res = await fetch(`/api/forecasts/${predictionId}/context`, {
        method: 'POST',
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `${t('failed')} (${res.status})`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()!

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const msg = JSON.parse(line.slice(6)) as { type: string } & Record<string, unknown>

          if (msg.type === 'summary') {
            setCurrentContext(msg.newContext as string)
            setContextUpdatedAt(msg.contextUpdatedAt as string)
            setIsContextOpen(true)
            setAnalyzeStep('estimating')
            toast.loading(t('stepEstimating'), { id: 'analyze' })
          } else if (msg.type === 'done') {
            if (msg.timings) {
              const tr = msg.timings as { searchMs: number; llmMs: number; oracleMs: number }
              saveTimings({ searchMs: tr.searchMs, llmMs: tr.llmMs, oracleMs: tr.oracleMs })
            }
            const timeline = (msg.timeline as Snapshot[]) || []
            setSnapshots(timeline)
            onAiEstimate?.(toAiEstimate(timeline[0]))
            toast.success(t('updated'), { id: 'analyze', duration: 3000 })
          } else if (msg.type === 'error') {
            throw new Error((msg.message as string) || t('failed'))
          }
        }
      }
    } catch (e) {
      log.error({ err: e }, 'Failed to analyze context')
      toast.error(toError(e).message || t('failed'), { id: 'analyze' })
    } finally {
      stepTimers.current.forEach(clearTimeout)
      stepTimers.current = []
      setIsAnalyzing(false)
      setAnalyzeStep(null)
    }
  }

  // UTC-stable so snapshot timestamps render in the SSR HTML without a hydration
  // mismatch (the timeline is prefetched for SEO).
  const formatDate = (dateStr: string) => formatDisplayDateTime(dateStr)

  const previousSnapshots = snapshots.slice(1)

  // Don't render section at all if no context and user can't analyze
  if (!currentContext && !canAnalyze && hasFetched) {
    return null
  }

  return (
    <div className="mb-8">
      {/* Header. The toggle target and the "analyze" action are siblings, not
          nested — a focusable control inside a role="button"/<button> container
          is an accessibility violation (double tab stop, screen readers treat
          role="button" as a leaf and can hide the nested control). */}
      <div className="w-full flex items-center justify-between mb-3 group">
        <button
          type="button"
          onClick={() => setIsContextOpen((o) => !o)}
          aria-expanded={isContextOpen}
          aria-controls={`context-panel-${predictionId}`}
          className="flex items-center gap-2 text-left"
        >
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {t('title')}
          </h2>
          {isContextOpen ? (
            <ChevronUp className="w-4 h-4 text-gray-400 group-hover:text-gray-300 transition-colors" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-gray-300 transition-colors" aria-hidden="true" />
          )}
        </button>
        {canAnalyze && aiResearch && (
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            aria-disabled={isAnalyzing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-cobalt/10 hover:bg-blue-100 rounded-md transition-colors aria-disabled:opacity-50 aria-disabled:pointer-events-none"
          >
            <Loader2 className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : 'hidden'}`} aria-hidden="true" />
            {!isAnalyzing && <RefreshCw className="w-4 h-4" aria-hidden="true" />}
            {isAnalyzing && analyzeStep
              ? t(`step${analyzeStep.charAt(0).toUpperCase()}${analyzeStep.slice(1)}` as 'stepSearching' | 'stepAnalyzing' | 'stepEstimating')
              : t('analyze')}
          </button>
        )}
      </div>

      {/* Current context card — always in the DOM (crawlable); collapsed via CSS
          rather than removed, so the AI summary, estimate, reasoning and Oracle
          sources are part of the SSR HTML for SEO. */}
      {currentContext && (
        <div id={`context-panel-${predictionId}`} className={`p-4 border border-navy-600 rounded-xl bg-navy-700 shadow-sm ${isContextOpen ? '' : 'hidden'}`}>
          <p className="text-gray-300 whitespace-pre-wrap leading-relaxed">{currentContext}</p>
          {contextUpdatedAt && (
            <p className="text-xs text-gray-400 mt-2" suppressHydrationWarning>
              {t('lastUpdated')}: {formatDate(contextUpdatedAt)}
            </p>
          )}
          {/* News anchor */}
          {newsAnchor && (
            <div className="mt-3 pt-3 border-t border-navy-600">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Based on</p>
              <a
                href={newsAnchor.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-cobalt-light hover:underline"
              >
                {newsAnchor.source || newsAnchor.title}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
          {/* AI probability estimate.
              Source badge ("Oracle" vs "LLM estimate") makes the provenance
              of the number explicit: when the Oracle is unreachable / has no
              usable predictions, daatan silently falls back to the legacy
              LLM `guessChances` path which returns only a point estimate.
              Without the badge the user sees a single number with no CI and
              has no way to know which path produced it. */}
          {snapshots[0]?.externalProbability != null && (() => {
            const latest = snapshots[0]
            const oracle = latest.oracleSnapshot ?? null
            const isOracle = oracle != null
            return (
              <div className="mt-3 pt-3 border-t border-navy-600">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">AI estimate</p>
                  <span
                    className={
                      isOracle
                        ? 'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-500/15 text-gray-400 border border-gray-500/30'
                    }
                    title={
                      isOracle
                        ? 'TruthMachine Oracle — calibrated multi-source estimate with confidence interval'
                        : 'LLM fallback — single point estimate, used when Oracle has no usable sources'
                    }
                  >
                    {isOracle ? 'Oracle' : 'LLM estimate'}
                  </span>
                </div>
                <p className="text-2xl font-black text-amber-400">
                  {latest.externalProbability}%
                  {oracle && oracle.ciHigh > oracle.ciLow && (
                    <span className="ml-2 text-xs font-normal text-gray-400">
                      ± {Math.round((oracle.ciHigh - oracle.ciLow) / 2)}%
                    </span>
                  )}
                </p>
                {latest.externalReasoning && (
                  <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                    {latest.externalReasoning}
                    {oracle && ` · ${oracle.articlesUsed} article${oracle.articlesUsed === 1 ? '' : 's'}`}
                  </p>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* Previous updates toggle — only visible when context is expanded */}
      {isContextOpen && previousSnapshots.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setIsTimelineOpen(!isTimelineOpen)}
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-text-secondary transition-colors"
          >
            {isTimelineOpen ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            {previousSnapshots.length === 1 
              ? t('previousUpdates', { count: 1 }) 
              : t('previousUpdatesPlural', { count: previousSnapshots.length })}
          </button>

          {/* Collapsible timeline */}
          {isTimelineOpen && (
            <div className="mt-3 ml-2 border-l-2 border-navy-600 pl-4 space-y-4">
              {previousSnapshots.map((snap) => (
                <div key={snap.id} className="relative">
                  {/* Timeline dot */}
                  <div className="absolute -left-[1.3rem] top-1 w-2.5 h-2.5 rounded-full bg-gray-300 border-2 border-white" />
                  <div className="text-xs text-gray-400 mb-1" suppressHydrationWarning>
                    {formatDate(snap.createdAt)}
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed">{snap.summary}</p>
                  {/* Sources — grouped by domain, deduped, with a per-source count */}
                  {(() => {
                    const grouped = groupSources((snap.sources as Source[]) ?? [])
                    if (grouped.length === 0) return null
                    return (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {grouped.map((g, i) => (
                          <a
                            key={i}
                            href={g.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-xs text-blue-500 hover:text-cobalt-light hover:underline"
                          >
                            {g.source}{g.count > 1 ? ` (${g.count})` : ''}
                            <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
