'use client'
import Link from 'next/link'
import { Calendar, Target, User } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { UserLink } from '@/components/UserLink'
import { RoleBadge } from '@/components/RoleBadge'
import { formatDisplayDate, formatDisplayDateTime } from '@/lib/utils/date'
import type { Prediction } from './types'

interface Props {
  prediction: Prediction
  variant?: 'desktop' | 'mobile'
}

export function ForecastInfoPanel({ prediction, variant = 'desktop' }: Props) {
  const t = useTranslations('forecast')
  // Mobile shows the two date cards side by side; below sm the half-width card
  // can't fit the full timestamp or label, so use the date-only format and the
  // short label there (full versions from sm up).
  const dateCell = (date: string) =>
    variant === 'mobile' ? (
      <>
        <span className="sm:hidden">{formatDisplayDate(date)}</span>
        <span className="hidden sm:inline">{formatDisplayDateTime(date)}</span>
      </>
    ) : (
      formatDisplayDateTime(date)
    )
  const dateLabel = (shortKey: string, fullKey: string) =>
    variant === 'mobile' ? (
      <>
        <span className="sm:hidden">{t(shortKey)}</span>
        <span className="hidden sm:inline">{t(fullKey)}</span>
      </>
    ) : (
      t(fullKey)
    )
  return (
    <>
      <div className={variant === 'mobile' ? 'grid grid-cols-2 gap-4 mb-8' : 'grid grid-cols-1 gap-3'}>
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
            {dateLabel('creationDateShort', 'creationDate')}
          </div>
          <div className="text-white font-semibold truncate">
            {dateCell(prediction.createdAt)}
          </div>
        </div>

        <div className="p-4 border border-navy-600 rounded-xl bg-navy-700 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
            <Calendar className="w-3.5 h-3.5" />
            {dateLabel('deadlineShort', 'deadline')}
          </div>
          <div className="text-white font-semibold truncate">
            {dateCell(prediction.resolveByDatetime)}
          </div>
        </div>

        <div className={`p-4 border border-navy-600 rounded-xl bg-navy-700 shadow-sm ${variant === 'mobile' ? 'col-span-2 sm:col-span-1' : ''}`}>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">
            <Target className="w-3.5 h-3.5" />
            Tags
          </div>
          <div className="flex flex-wrap gap-1">
            {prediction.tags && prediction.tags.length > 0 ? (
              prediction.tags.map((tag) => (
                <Link
                  key={tag.id}
                  href={`/tags/${tag.slug}`}
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
      </div>
    </>
  )
}
