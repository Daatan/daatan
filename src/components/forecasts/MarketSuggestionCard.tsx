'use client'

import { TrendingUp, ExternalLink, X, Info } from 'lucide-react'
import { useTranslations } from 'next-intl'

/** A "same question" market from /api/forecasts/suggest-market. */
export type MarketMatch = {
  externalMarketId: string
  provider: 'POLYMARKET' | 'KALSHI'
  providerLabel: string
  question: string
  yesProbability: number
  url: string
  score: number
}

interface Props {
  match: MarketMatch
  onLink: () => void
  onDismiss: () => void
}

/**
 * Offer to link a similar prediction market (daatan#2069). Shows the market's
 * full question (never truncated), opens the market in a new tab so the author
 * can check it, and says plainly that a market is almost never the exact same
 * question as the forecast. Used by the create wizard and the Express review.
 */
export function MarketSuggestionCard({ match, onLink, onDismiss }: Props) {
  const t = useTranslations('wizard')

  return (
    <div className="mb-6 p-4 rounded-xl border border-pink-500/40 bg-pink-500/5" data-testid="market-suggestion">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-pink-400">
          <TrendingUp className="w-4 h-4 shrink-0" />
          {t('marketMatch', { provider: match.providerLabel, score: match.score })}
        </div>
        <button
          onClick={onDismiss}
          className="text-gray-400 hover:text-gray-200 shrink-0"
          aria-label={t('dismiss')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <a
        href={match.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 block p-3 rounded-lg border border-pink-500/20 bg-navy-800/60 hover:border-pink-400 hover:bg-pink-500/10 transition-colors"
      >
        <p className="text-sm sm:text-base text-white font-medium whitespace-normal break-words" dir="auto">
          {match.question}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-gray-400">{t('marketYes', { pct: match.yesProbability })}</span>
          <span className="inline-flex items-center gap-1 text-pink-300 font-semibold">
            {t('openMarket', { provider: match.providerLabel })}
            <ExternalLink className="w-3 h-3" />
          </span>
        </div>
      </a>

      <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-400">
        <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>{t('marketNotIdentical', { provider: match.providerLabel })}</span>
      </p>

      <div className="mt-3 flex gap-2">
        <button
          onClick={onLink}
          className="px-3 py-1.5 text-sm font-semibold bg-pink-600 hover:bg-pink-500 text-white rounded-lg"
        >
          {t('linkMarket')}
        </button>
        <button
          onClick={onDismiss}
          className="px-3 py-1.5 text-sm text-gray-300 hover:text-white"
        >
          {t('keepSeparate')}
        </button>
      </div>
    </div>
  )
}
