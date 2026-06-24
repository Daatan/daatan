'use client'

import { Newspaper, ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ContributingSource } from '@/lib/services/forecast-sources'
import { canonicalKey } from '@/lib/utils/canonical-url'

type Side = 'yes' | 'no' | 'neutral'

/** Stance → side: same thresholds as the Oracle-snapshot source chips. */
function getSide(stance: number | null): Side {
  if (stance == null) return 'neutral'
  if (stance > 0.15) return 'yes'
  if (stance < -0.15) return 'no'
  return 'neutral'
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
 * The publications that fed the Oracle's estimate, presented as "voters" — the
 * same "will happen / won't happen" language readers use when they vote. A
 * tug-of-war lean bar summarises where the press sits; below it, one compact
 * card per matched article splits into the two columns by the stance it took
 * (article title, outlet and date live in the hover hint). Sits in its own
 * section below the human forecasters and never affects the community number.
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

  const groups: Record<Side, ContributingSource[]> = { yes: [], no: [], neutral: [] }
  for (const s of unique) groups[getSide(s.stance)].push(s)

  const meanYes = unique.reduce((sum, s) => sum + articleProbYes(s), 0) / unique.length
  const leanPct = Math.round(meanYes * 100)
  const summary =
    leanPct > 50 ? t('pressLeanYes', { pct: leanPct })
    : leanPct < 50 ? t('pressLeanNo', { pct: 100 - leanPct })
    : t('pressSplit')
  const countText = unique.length === 1 ? t('count', { count: 1 }) : t('countPlural', { count: unique.length })

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

  // Compact one-row card. The headline, outlet and date move into a native hover
  // hint so the grid stays scannable — the side + certainty badge carries the signal.
  const VoterCard = ({ s, side }: { s: ContributingSource; side: Side }) => {
    const name = s.author || outletLabel(s)
    const subtitle = [s.author ? outletLabel(s) : null, fmtDate(s.publishedAt), originText(s.origin)]
      .filter(Boolean)
      .join(' · ')
    const hint = [s.title, subtitle].filter(Boolean).join('\n')
    const meta = sideMeta[side]
    return (
      <a
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        title={hint || undefined}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-navy-600 bg-navy-700 hover:bg-navy-600 transition-colors group"
      >
        <Newspaper className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        <span className="font-medium text-white truncate flex-1 min-w-0">{name}</span>
        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${meta.badge}`}>
          {meta.short}{s.certainty != null ? ` ${Math.round(s.certainty * 100)}%` : ''}
        </span>
        <ExternalLink className="w-3 h-3 text-gray-600 shrink-0 group-hover:text-gray-300" />
      </a>
    )
  }

  const Column = ({ side }: { side: Side }) => (
    <div>
      <p className={`text-[11px] font-bold uppercase tracking-wide mb-2 ${sideMeta[side].head}`}>
        {sideMeta[side].label} ({groups[side].length})
      </p>
      <div className="space-y-1.5">
        {groups[side].map((s) => <VoterCard key={s.url} s={s} side={side} />)}
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
        <div className="flex items-center gap-2 text-[11px] mt-1.5">
          <span className="text-emerald-400 font-medium">{groups.yes.length} {sideMeta.yes.short}</span>
          <span className="text-gray-600">·</span>
          <span className="text-gray-400">{groups.neutral.length} {sideMeta.neutral.short}</span>
          <span className="text-gray-600">·</span>
          <span className="text-rose-400 font-medium">{groups.no.length} {sideMeta.no.short}</span>
        </div>
        <span className="sr-only">{summary}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {groups.yes.length > 0 && <Column side="yes" />}
        {groups.no.length > 0 && <Column side="no" />}
      </div>

      {groups.neutral.length > 0 && (
        <div className="mt-4 opacity-80">
          <Column side="neutral" />
        </div>
      )}
    </div>
  )
}
