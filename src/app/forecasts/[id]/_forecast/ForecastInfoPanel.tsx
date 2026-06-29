'use client'
import Link from 'next/link'
import { Calendar, Target, TrendingUp, ExternalLink, User } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { UserLink } from '@/components/UserLink'
import { RoleBadge } from '@/components/RoleBadge'
import type { Prediction } from './types'

interface Props {
  prediction: Prediction
  variant?: 'desktop' | 'mobile'
  isMounted: boolean
}

export function ForecastInfoPanel({ prediction, variant = 'desktop', isMounted }: Props) {
  const t = useTranslations('forecast')
  const market = prediction.externalMarket
  const marketProbability =
    market && market.snapshots.length > 0
      ? market.snapshots[market.snapshots.length - 1].probability
      : null
  const providerLabel = market
    ? market.provider === 'KALSHI'
      ? 'Kalshi'
      : 'Polymarket'
    : ''
  // Always resolve a usable market URL: some early links stored an empty `url`,
  // which would render a dead `href=""`. Fall back to the slug-derived URL.
  const marketUrl = market
    ? market.url ||
      (market.provider === 'KALSHI'
        ? `https://kalshi.com/markets/${market.slug}`
        : `https://polymarket.com/event/${market.slug}`)
    : ''
  return (
    <>
      <div className={variant === 'mobile' ? 'grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8' : 'grid grid-cols-1 gap-3'}>
        {variant === 'desktop' && (
          <div className="p-4 border border-navy-600 rounded-xl bg-navy-700 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
              <User className="w-3.5 h-3.5" />
              {t('author')}
            </div>
            <UserLink
              userId={prediction.author.id}
              username={prediction.author.username}
              name={prediction.author.name}
              image={prediction.author.image}
              showAvatar={true}
              avatarSize={28}
              className="w-full"
            >
              <span className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="font-semibold text-white truncate">{prediction.author.name}</span>
                {prediction.author.role && (
                  <RoleBadge role={prediction.author.role} size="sm" />
                )}
              </span>
              <span className="text-xs text-gray-500 shrink-0">{t('reputationShort')} {prediction.author.rs.toFixed(0)}</span>
            </UserLink>
          </div>
        )}

        <div className="p-4 border border-navy-600 rounded-xl bg-navy-700 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
            <Calendar className="w-3.5 h-3.5" />
            {t('creationDate')}
          </div>
          <div className="text-white font-semibold truncate" suppressHydrationWarning>
            {isMounted && new Date(prediction.createdAt).toLocaleString('en-US', {
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
                <Link
                  key={tag.id}
                  href={`/?tags=${encodeURIComponent(tag.name)}`}
                  title={t('filterByTagTooltip', { tag: tag.name })}
                  className="px-2 py-0.5 bg-navy-800 text-gray-400 hover:text-white hover:border-cobalt hover:bg-navy-600 text-[10px] font-bold uppercase tracking-wider rounded border border-navy-600 transition-colors"
                >
                  {tag.name}
                </Link>
              ))
            ) : (
              <span className="text-gray-400 italic text-xs">None</span>
            )}
          </div>
        </div>

        {market && (
          <a
            href={marketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-4 border border-navy-600 rounded-xl bg-navy-700 shadow-sm hover:border-pink-500/60 transition-colors group"
          >
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
              <TrendingUp className="w-3.5 h-3.5" />
              {providerLabel}
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
            <div className="mt-1.5 text-[11px] font-medium text-pink-400 group-hover:text-pink-300">
              View on {providerLabel} →
            </div>
          </a>
        )}
      </div>
    </>
  )
}
