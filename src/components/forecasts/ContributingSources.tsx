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
 * The publications that fed the Oracle's estimate, presented as "voters": one
 * card per matched article, split into YES / NO columns by the stance it took
 * on the claim, with a press-lean summary. Sits in its own section below the
 * human forecasters and never affects the community number.
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

  const sideMeta: Record<Side, { label: string; head: string; badge: string }> = {
    yes: { label: t('voteYes'), head: 'text-emerald-400', badge: 'bg-emerald-500/20 text-emerald-300' },
    no: { label: t('voteNo'), head: 'text-rose-400', badge: 'bg-rose-500/20 text-rose-300' },
    neutral: { label: t('voteNeutral'), head: 'text-gray-400', badge: 'bg-gray-500/20 text-gray-400' },
  }

  const originLabel = (origin: ContributingSource['origin']): string | null => {
    if (origin === 'oracle') return `🔮 ${t('originOracle')}`
    if (origin === 'both') return `🔮🗞 ${t('originBoth')}`
    if (origin === 'indexer') return `🗞 ${t('originIndexer')}`
    return null
  }

  const VoterCard = ({ s, side }: { s: ContributingSource; side: Side }) => {
    const name = s.author || outletLabel(s)
    const subtitleOutlet = s.author ? outletLabel(s) : null
    const date = fmtDate(s.publishedAt)
    const origin = originLabel(s.origin)
    const meta = sideMeta[side]
    return (
      <a
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-start gap-2.5 p-3 rounded-xl border border-navy-600 bg-navy-700 hover:bg-navy-600 transition-colors group"
      >
        <Newspaper className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-white truncate">{name}</span>
            <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${meta.badge}`}>
              {meta.label}{s.certainty != null ? ` ${Math.round(s.certainty * 100)}%` : ''}
            </span>
          </div>
          {origin && (
            <span className="inline-block text-[10px] font-medium text-gray-400 mt-0.5">{origin}</span>
          )}
          {(subtitleOutlet || date) && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">
              {[subtitleOutlet, date].filter(Boolean).join(' · ')}
            </p>
          )}
          {s.title && (
            <p className="text-sm text-gray-300 mt-1 line-clamp-2 group-hover:text-gray-200">{s.title}</p>
          )}
        </div>
        <ExternalLink className="w-3.5 h-3.5 text-gray-500 shrink-0 mt-0.5 group-hover:text-gray-300" />
      </a>
    )
  }

  const Column = ({ side }: { side: Side }) => (
    <div>
      <p className={`text-[11px] font-bold uppercase tracking-wide mb-2 ${sideMeta[side].head}`}>
        {sideMeta[side].label} ({groups[side].length})
      </p>
      <div className="space-y-2">
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
      <p className="text-sm text-gray-400 mb-3">{t('subtitle')}</p>

      <div className="inline-flex items-center px-3 py-1.5 mb-4 rounded-lg bg-navy-800 border border-navy-600 text-sm font-semibold text-gray-200">
        {summary}
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
