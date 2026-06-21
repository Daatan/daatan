'use client'

import { Newspaper, ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ContributingSource } from '@/lib/services/forecast-sources'

type StanceGroup = 'yes' | 'no' | 'neutral'

/** Same thresholds as the Oracle-snapshot source chips so the two agree. */
function getStanceGroup(stance: number | null): StanceGroup {
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

/**
 * Roster of publications that fed the Oracle's estimate for this forecast,
 * grouped by the stance each took on the claim. Sits below the human
 * forecasters and is treated the same way — each source is a "forecaster"
 * with a position — but kept in its own section.
 */
export function ContributingSources({ sources }: { sources: ContributingSource[] }) {
  const t = useTranslations('sources')

  // Dedupe by article URL — a forecast_match is one delivered article.
  const seen = new Set<string>()
  const unique = sources.filter((s) => {
    if (!s.url || seen.has(s.url)) return false
    seen.add(s.url)
    return true
  })

  if (unique.length === 0) return null

  const groups: Record<StanceGroup, ContributingSource[]> = { yes: [], no: [], neutral: [] }
  for (const s of unique) groups[getStanceGroup(s.stance)].push(s)

  const config: Record<StanceGroup, { label: string; headerClass: string; dotClass: string }> = {
    yes: { label: t('favorsYes'), headerClass: 'text-emerald-400', dotClass: 'bg-emerald-400' },
    no: { label: t('favorsNo'), headerClass: 'text-rose-400', dotClass: 'bg-rose-400' },
    neutral: { label: t('neutral'), headerClass: 'text-gray-400', dotClass: 'bg-gray-500' },
  }
  const order: StanceGroup[] = ['yes', 'no', 'neutral']
  const activeGroups = order.filter((g) => groups[g].length > 0)

  return (
    <div className="mt-12" data-testid="contributing-sources">
      <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-1">
        <Newspaper className="w-5 h-5" />
        {t('title')}
        <span className="text-sm font-normal text-gray-500">
          ({unique.length === 1 ? t('count', { count: 1 }) : t('countPlural', { count: unique.length })})
        </span>
      </h2>
      <p className="text-sm text-gray-400 mb-4">{t('subtitle')}</p>

      <div className="space-y-5">
        {activeGroups.map((group) => {
          const cfg = config[group]
          return (
            <div key={group}>
              <p className={`text-[11px] font-bold uppercase tracking-wide mb-2 ${cfg.headerClass}`}>
                {cfg.label} ({groups[group].length})
              </p>
              <div className="space-y-2">
                {groups[group].map((s) => (
                  <a
                    key={s.url}
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-3 rounded-xl border border-navy-600 bg-navy-700 hover:bg-navy-600 transition-colors group"
                  >
                    <span className={`mt-1.5 w-2 h-2 shrink-0 rounded-full ${cfg.dotClass}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white">{outletLabel(s)}</span>
                        {s.author && (
                          <span className="text-xs text-gray-400">{t('by', { author: s.author })}</span>
                        )}
                        {s.certainty != null && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-navy-600 text-gray-300 border border-navy-500">
                            {t('certainty', { value: Math.round(s.certainty * 100) })}
                          </span>
                        )}
                      </div>
                      {s.title && (
                        <p className="text-sm text-gray-300 mt-0.5 line-clamp-2 group-hover:text-gray-200">
                          {s.title}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-gray-500 shrink-0 mt-1 group-hover:text-gray-300" />
                  </a>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
