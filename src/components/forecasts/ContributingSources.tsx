'use client'

import { Newspaper, ExternalLink, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ContributingSource } from '@/lib/services/forecast-sources'
import { canonicalKey } from '@/lib/utils/canonical-url'
import { Avatar } from '@/components/Avatar'

type Side = 'yes' | 'no' | 'neutral'

/** Stance → side: same thresholds as the Oracle-snapshot source chips. */
function getSide(stance: number | null): Side {
  if (stance == null) return 'neutral'
  if (stance > 0.15) return 'yes'
  if (stance < -0.15) return 'no'
  return 'neutral'
}

const dotColor: Record<Side, string> = {
  yes: 'bg-emerald-500',
  no: 'bg-rose-500',
  neutral: 'bg-gray-500',
}

/** Outlet label — its `source`, else the URL host (sans www), else the title. */
function outletLabel(s: ContributingSource): string {
  if (s.source) return s.source
  try {
    return new URL(s.url).hostname.replace(/^www\./, '')
  } catch {
    return s.title || s.url
  }
}

/** Registrable host (sans www), the grouping key for an outlet. */
function outletDomain(s: ContributingSource): string {
  try {
    return new URL(s.url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return (s.source ?? '').toLowerCase() || 'unknown'
  }
}

/** Deterministic date (fixed locale + UTC) so SSR and client markup agree. */
function fmtDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** Each article's implied P(YES): centred at 0.5, pushed by certainty toward its side. */
function articleProbYes(s: ContributingSource): number {
  const side = getSide(s.stance)
  if (side === 'neutral') return 0.5
  const mag = (s.certainty ?? 0.5) * 0.5
  return side === 'yes' ? 0.5 + mag : 0.5 - mag
}

/**
 * How much this article's stance actually moves the needle: |stance| × certainty.
 * Used to pick an outlet's lead article — certainty alone isn't a safe proxy for
 * relevance, since the Oracle can be highly certain about an off-topic article's
 * stance on ITS OWN subject while being less certain, but far more decisive, about
 * the one article that's actually on-topic. Magnitude × certainty favours the
 * article that actually says something about the claim.
 */
function signalStrength(s: ContributingSource): number {
  return Math.abs(s.stance ?? 0) * (s.certainty ?? 0.5)
}

type OutletGroup = {
  domain: string
  name: string
  /** Sorted by signal strength, most decisive first; the first entry (not an outlet-wide average) drives side/pct. */
  articles: ContributingSource[]
  side: Side
  pct: number | null
}

/**
 * The publications that fed the Oracle's estimate, grouped by outlet and shown as
 * "voters" in the same "will happen / won't happen" language readers use to vote.
 * A tug-of-war lean bar summarises where the press sits; below it, outlets split
 * into will / won't / neutral columns by their single most-decisive article's
 * stance (highest |stance| × certainty) — not an outlet-wide average, which could
 * cancel a strong signal against an unrelated article from the same domain and
 * mislabel the whole outlet "neutral"; not raw certainty either, since the Oracle
 * can be very certain about an off-topic article's stance on its own subject.
 * An outlet with several articles is an expandable card listing each; a
 * single-article outlet is a plain link. Articles news-indexer matched but the
 * Oracle gate-rejected as off-topic (no stance) don't get voter cards — just a
 * passing count, so they're visible without being treated as evidence.
 * Sits below the human forecasters and never affects the community number.
 */
export function ContributingSources({ sources }: { sources: ContributingSource[] }) {
  const t = useTranslations('sources')

  // One voter per article — dedupe by canonical URL (same key the merge service uses).
  const seen = new Set<string>()
  const unique = sources.filter((s) => {
    if (!s.url) return false
    const key = canonicalKey(s.url)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (unique.length === 0) return null

  // Only stance-scored articles were actually incorporated into the Oracle's estimate;
  // a null stance means news-indexer matched it but the Oracle gate-rejected it as not
  // bearing on the claim. Those are counted, not turned into voter cards.
  const used = unique.filter((s) => s.stance != null)
  const notUsedCount = unique.length - used.length
  const notUsedText = notUsedCount > 0
    ? t(notUsedCount === 1 ? 'notUsed' : 'notUsedPlural', { count: notUsedCount })
    : null

  if (used.length === 0) {
    return (
      <div className="mt-12" data-testid="contributing-sources">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-1">
          <Newspaper className="w-5 h-5" />
          {t('title')}
        </h2>
        {notUsedText && <p className="text-sm text-gray-500">{notUsedText}</p>}
      </div>
    )
  }

  // Press lean is article-granular (it's about the coverage that fed the Oracle),
  // independent of grouping, and only over articles the Oracle actually used.
  const pressMeanYes = used.reduce((sum, s) => sum + articleProbYes(s), 0) / used.length
  const leanPct = Math.round(pressMeanYes * 100)
  const summary =
    leanPct > 50 ? t('pressLeanYes', { pct: leanPct })
    : leanPct < 50 ? t('pressLeanNo', { pct: 100 - leanPct })
    : t('pressSplit')
  const countText = used.length === 1 ? t('count', { count: 1 }) : t('countPlural', { count: used.length })

  // Group used articles by outlet; each card's side/badge come from its single
  // most-decisive article (see doc comment above), not an outlet-wide average.
  const byDomain = new Map<string, ContributingSource[]>()
  for (const s of used) {
    const d = outletDomain(s)
    const arr = byDomain.get(d) ?? []
    arr.push(s)
    byDomain.set(d, arr)
  }
  const outletGroups: OutletGroup[] = [...byDomain.entries()].map(([domain, articles]) => {
    const sorted = [...articles].sort((a, b) => signalStrength(b) - signalStrength(a))
    const lead = sorted[0]
    const side = getSide(lead.stance)
    const leadProbYes = articleProbYes(lead)
    const pct = side === 'yes' ? Math.round(leadProbYes * 100) : side === 'no' ? Math.round((1 - leadProbYes) * 100) : null
    return {
      domain,
      name: articles.find(a => a.source)?.source || domain,
      articles: sorted,
      side,
      pct,
    }
  })
  const byCol: Record<Side, OutletGroup[]> = { yes: [], no: [], neutral: [] }
  for (const g of outletGroups) byCol[g.side].push(g)
  for (const side of ['yes', 'no', 'neutral'] as Side[]) {
    byCol[side].sort((a, b) => b.articles.length - a.articles.length || (b.pct ?? 0) - (a.pct ?? 0))
  }

  const sideMeta: Record<Side, { label: string; short: string; head: string; badge: string }> = {
    yes: { label: t('voteYes'), short: t('shortYes'), head: 'text-emerald-400', badge: 'bg-emerald-500/20 text-emerald-300' },
    no: { label: t('voteNo'), short: t('shortNo'), head: 'text-rose-400', badge: 'bg-rose-500/20 text-rose-300' },
    neutral: { label: t('voteNeutral'), short: t('shortNeutral'), head: 'text-gray-400', badge: 'bg-gray-500/20 text-gray-400' },
  }

  const originText = (origin: ContributingSource['origin']): string | null => {
    if (origin === 'oracle') return t('originOracle')
    if (origin === 'both') return t('originBoth')
    if (origin === 'indexer') return t('originIndexer')
    return null
  }

  // The will/won't word is dropped to declutter; the side stays clear via colour
  // (green/red), the column it sits in, an ↑/↓ arrow (colour-blind safe), and the
  // full label on hover.
  const Badge = ({ side, pct }: { side: Side; pct: number | null }) => {
    const arrow = side === 'yes' ? '↑' : side === 'no' ? '↓' : '–'
    return (
      <span
        title={sideMeta[side].label}
        className={`shrink-0 text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded ${sideMeta[side].badge}`}
      >
        {arrow}{side !== 'neutral' && pct != null ? ` ${pct}%` : ''}
      </span>
    )
  }

  // One article inside an expanded outlet card: stance dot, headline, per-article badge.
  const ArticleRow = ({ s }: { s: ContributingSource }) => {
    const side = getSide(s.stance)
    const title = s.title || outletLabel(s)
    const hint = [s.title, [s.author, fmtDate(s.publishedAt), originText(s.origin)].filter(Boolean).join(' · ')]
      .filter(Boolean)
      .join('\n')
    return (
      <a
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        title={hint || undefined}
        className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-navy-600 group/row"
      >
        <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${dotColor[side]}`} />
        <span className="text-xs text-gray-300 flex-1 min-w-0 line-clamp-2 group-hover/row:text-gray-200">{title}</span>
        <Badge side={side} pct={s.certainty != null ? Math.round(s.certainty * 100) : null} />
        <ExternalLink className="w-3 h-3 text-gray-600 shrink-0 mt-0.5" />
      </a>
    )
  }

  const OutletCard = ({ g }: { g: OutletGroup }) => {
    // Single-article outlet → a plain link showing the headline inline (no expand).
    if (g.articles.length === 1) {
      const s = g.articles[0]
      const hint = [s.title, [s.author, fmtDate(s.publishedAt), originText(s.origin)].filter(Boolean).join(' · ')]
      .filter(Boolean)
      .join('\n')
      return (
        <a
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          title={hint || undefined}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-navy-600 bg-navy-700 hover:bg-navy-600 transition-colors group/card"
        >
          <Avatar src={null} name={g.name} size={20} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-white truncate">{g.name}</span>
            {s.title && <span className="block text-xs text-gray-400 truncate group-hover/card:text-gray-300">{s.title}</span>}
          </span>
          <Badge side={g.side} pct={g.pct} />
          <ExternalLink className="w-3 h-3 text-gray-600 shrink-0 group-hover/card:text-gray-300" />
        </a>
      )
    }

    // Multi-article outlet → expandable card; native <details>, no React re-render.
    return (
      <details className="group/card rounded-lg border border-navy-600 bg-navy-700 overflow-hidden">
        <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none list-none hover:bg-navy-600 [&::-webkit-details-marker]:hidden">
          <Avatar src={null} name={g.name} size={20} className="shrink-0" />
          <span className="font-medium text-white truncate flex-1 min-w-0">{g.name}</span>
          <span className="shrink-0 text-[10px] text-gray-500">{g.articles.length}</span>
          <Badge side={g.side} pct={g.pct} />
          <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0 transition-transform group-open/card:rotate-180" />
        </summary>
        <div className="px-2 pb-2 pt-0.5 space-y-0.5 border-t border-navy-600">
          {g.articles.map((s) => <ArticleRow key={s.url} s={s} />)}
        </div>
      </details>
    )
  }

  const Column = ({ side }: { side: Side }) => (
    <div>
      <p className={`text-[11px] font-bold uppercase tracking-wide mb-2 ${sideMeta[side].head}`}>
        {sideMeta[side].label} ({byCol[side].length})
      </p>
      <div className="space-y-1.5">
        {byCol[side].map((g) => <OutletCard key={g.domain} g={g} />)}
      </div>
    </div>
  )

  return (
    <div className="mt-12" data-testid="contributing-sources">
      <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-1">
        <Newspaper className="w-5 h-5" />
        {t('title')}
        <span className="text-sm font-normal text-gray-500">({countText})</span>
      </h2>
      <p className="text-sm text-gray-400 mb-4">{t('subtitle')}</p>

      {/* Hero: a tug-of-war bar — green ("will happen") vs red ("won't"), filled to
          the press lean, with a centre marker. The decorative bar is aria-hidden;
          the sr-only summary below carries the same information for screen readers. */}
      <div className="mb-5 max-w-md">
        <div className="flex items-center justify-between text-[11px] font-medium mb-1.5">
          <span className="uppercase tracking-wide text-gray-400">{t('leanCaption')}</span>
          <span className="tabular-nums text-gray-300">{leanPct}% · {sideMeta.yes.short}</span>
        </div>
        <div className="relative h-2.5 rounded-full overflow-hidden bg-rose-500/30" aria-hidden="true">
          <div className="absolute inset-y-0 left-0 bg-emerald-500/70" style={{ width: `${leanPct}%` }} />
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/50" />
        </div>
        <span className="sr-only">{summary}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {byCol.yes.length > 0 && <Column side="yes" />}
        {byCol.no.length > 0 && <Column side="no" />}
      </div>

      {byCol.neutral.length > 0 && (
        <div className="mt-4 opacity-80">
          <Column side="neutral" />
        </div>
      )}

      {notUsedText && <p className="mt-4 text-xs text-gray-500">{notUsedText}</p>}
    </div>
  )
}
