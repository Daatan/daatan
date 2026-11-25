'use client'

import { useTranslations } from 'next-intl'
import { MARKET_STALE_HOURS, type MarketReading } from '@/lib/market-display'
import { bidiIsolate } from '@/lib/utils/bidi'
import { formatDisplayDateTime } from '@/lib/utils/date'

export type AiLegendState =
  | { kind: 'value'; value: number }
  | { kind: 'abstained' }
  | { kind: 'none' }

export interface LegendMarket {
  /** "Polymarket" or "Kalshi". */
  provider: string
  reading: MarketReading
  question: string
  inverted: boolean
  resolved: boolean
}

interface Props {
  /** null = nobody has committed yet. */
  community: number | null
  you: number
  ai: AiLegendState
  market: LegendMarket | null
}

/**
 * The numbers under the forecast gauge, and what each one means (daatan#2323).
 * Hints live in a tap-to-open list so they work on touch; the same text is the
 * hover title on desktop.
 */
export function EstimateLegend({ community, you, ai, market }: Props) {
  const t = useTranslations('forecast')

  const marketHint = market
    ? [
        t('numbersMarket', { provider: market.provider }),
        t('marketAsks', { question: bidiIsolate(market.question) }),
        market.inverted ? t('numbersMarketInverted') : null,
        market.resolved
          ? t('numbersMarketClosed')
          : t('numbersMarketAt', { at: bidiIsolate(formatDisplayDateTime(market.reading.at)) }),
        !market.resolved && market.reading.stale ? t('numbersMarketStale', { hours: MARKET_STALE_HOURS }) : null,
      ].filter(Boolean).join(' ')
    : null

  return (
    <div className="w-full mt-6 xl:mt-10 border-t border-navy-600 pt-4 xl:pt-8">
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[10px] font-bold uppercase tracking-widest">
        <div className="flex items-center gap-2" title={t('numbersCommunity')} data-testid="legend-community">
          <div className="w-3 h-1 bg-[#A0AEC0] rounded-full" />
          <span className="text-gray-400">
            {community == null
              ? `${t('legendCommunity')} · ${t('legendNoForecastsYet')}`
              : `${t('legendCommunity')} ${community}%`}
          </span>
        </div>
        <div className="flex items-center gap-2" title={t('numbersYou')}>
          <div className="w-3 h-1.5 bg-[#3B82F6] rounded-full" />
          <span className="text-blue-400">{t('legendYou')} {you}%</span>
        </div>
        {ai.kind === 'abstained' ? (
          <div className="flex items-center gap-2" title={t('numbersAi')}>
            <div className="w-3 h-1 bg-[#FBBF24]/40 rounded-full" />
            <span className="text-amber-400/70">{t('legendAI')} · {t('aiInsufficientEvidence')}</span>
          </div>
        ) : ai.kind === 'value' ? (
          <div className="flex items-center gap-2" title={t('numbersAi')}>
            <div className="w-3 h-1 bg-[#FBBF24] rounded-full" />
            <span className="text-amber-400">{t('legendAI')} {ai.value}%</span>
          </div>
        ) : (
          <div className="flex items-center gap-2" title={t('numbersAi')} data-testid="ai-no-sources-yet">
            <div className="w-3 h-1 bg-[#FBBF24]/40 rounded-full" />
            <span className="text-amber-400/70">{t('legendAI')} · {t('aiNoSourcesYet')}</span>
          </div>
        )}
        {market && (
          <div className="flex items-center gap-2" title={marketHint ?? undefined} data-testid="legend-market">
            <div className="w-3 h-1 bg-[#F472B6] rounded-full" />
            <span className={market.reading.stale && !market.resolved ? 'text-gray-500' : 'text-pink-400'}>
              {market.provider} {market.reading.probability}%
              {market.resolved
                ? ` · ${t('legendMarketClosed')}`
                : market.reading.stale ? ` · ${t('legendMarketStale')}` : ''}
            </span>
          </div>
        )}
      </div>

      <details className="mt-4 text-left text-xs text-gray-400" data-testid="numbers-explainer">
        <summary className="cursor-pointer text-center underline decoration-dotted underline-offset-2 hover:text-gray-200">
          {t('numbersExplainer')}
        </summary>
        <dl className="mt-3 space-y-2">
          <div>
            <dt className="font-semibold text-gray-300">{t('legendCommunity')}</dt>
            <dd>{t('numbersCommunity')}</dd>
          </div>
          <div>
            <dt className="font-semibold text-blue-400">{t('legendYou')}</dt>
            <dd>{t('numbersYou')}</dd>
          </div>
          <div>
            <dt className="font-semibold text-amber-400">{t('numbersAiTitle')}</dt>
            <dd>{t('numbersAi')}</dd>
          </div>
          {market && (
            <div>
              <dt className="font-semibold text-pink-400">{market.provider}</dt>
              <dd>{marketHint}</dd>
            </div>
          )}
        </dl>
      </details>
    </div>
  )
}
