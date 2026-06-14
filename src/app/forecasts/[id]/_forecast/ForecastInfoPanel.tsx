'use client'
import { Calendar, Target, TrendingUp, ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Prediction } from './types'

interface Props {
  prediction: Prediction
  variant?: 'desktop' | 'mobile'
  isMounted: boolean
}

export function ForecastInfoPanel({ prediction, variant = 'desktop', isMounted }: Props) {
  const t = useTranslations('forecast')
  const market = prediction.polymarketMarket
  const marketProbability =
    market && market.snapshots.length > 0
      ? market.snapshots[market.snapshots.length - 1].probability
      : null
  return (
    <>
      <div className={variant === 'mobile' ? 'grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8' : 'grid grid-cols-1 gap-3'}>
        <div className="p-4 border border-navy-600 rounded-xl bg-navy-700 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
            <Calendar className="w-3.5 h-3.5" />
            {t('deadline')}
          </div>
          <div className="text-white font-semibold truncate" suppressHydrationWarning>
            {isMounted && new Date(prediction.resolveByDatetime).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZoneName: 'short',
            })}
          </div>
        </div>

        <div className="p-4 border border-navy-600 rounded-xl bg-navy-700 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
            <Target className="w-3.5 h-3.5" />
            Tags
          </div>
          <div className="flex flex-wrap gap-1">
            {prediction.tags && prediction.tags.length > 0 ? (
              prediction.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="px-2 py-0.5 bg-navy-800 text-gray-400 text-[10px] font-bold uppercase tracking-wider rounded border border-navy-600"
                >
                  {tag.name}
                </span>
              ))
            ) : (
              <span className="text-gray-400 italic text-xs">None</span>
            )}
          </div>
        </div>

        {market && (
          <a
            href={`https://polymarket.com/event/${market.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 border border-navy-600 rounded-xl bg-navy-700 shadow-sm hover:border-pink-500/60 transition-colors group"
          >
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
              <TrendingUp className="w-3.5 h-3.5" />
              Polymarket
              <ExternalLink className="w-3 h-3 ml-auto text-gray-500 group-hover:text-pink-400" />
            </div>
            <div className="flex items-baseline gap-2">
              {marketProbability != null ? (
                <span className="text-white font-semibold text-lg">{marketProbability}%</span>
              ) : (
                <span className="text-gray-400 italic text-xs">Awaiting price</span>
              )}
              {market.resolved && (
                <span className="text-[10px] font-bold uppercase tracking-wider text-pink-400">
                  Resolved
                </span>
              )}
            </div>
          </a>
        )}
      </div>
    </>
  )
}
