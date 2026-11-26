'use client'

import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { orderTopics, type TopicCounts } from '@/lib/topics'
import { useTopicLabel } from './useTopicLabel'

interface Props {
  selected: string[]
  counts: TopicCounts
  onChange: (tags: string[]) => void
}

/**
 * Always-visible, multi-select topic chips for both feeds (daatan#2330). On a phone they are
 * one scrolling row with a fade at the end edge so it reads as "there's more"; from `sm` up
 * they wrap. A forecast matches if it has any selected topic.
 */
export function TopicFilter({ selected, counts, onChange }: Props) {
  const t = useTranslations('topics')
  const label = useTopicLabel()
  const toggle = (tag: string) =>
    onChange(selected.includes(tag) ? selected.filter(s => s !== tag) : [...selected, tag])

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <div
          role="group"
          aria-label={t('filterLabel')}
          className="flex gap-2 overflow-x-auto scrollbar-hide pe-10 sm:flex-wrap sm:overflow-visible sm:pe-0"
        >
          {orderTopics(selected, counts).map(tag => {
            const isSelected = selected.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggle(tag)}
                aria-pressed={isSelected}
                className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center gap-1.5 ${isSelected
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-navy-700 text-gray-300 hover:bg-navy-600 hover:text-white'
                }`}
              >
                {label(tag)}
                {isSelected && <X className="w-3 h-3 opacity-70" aria-hidden />}
              </button>
            )
          })}
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 end-0 w-10 bg-gradient-to-l rtl:bg-gradient-to-r from-navy-900 to-transparent sm:hidden"
        />
      </div>
      {selected.length > 0 && (
        <p className="text-xs text-gray-400" data-testid="topics-selected">
          {t('selectedCount', { count: selected.length })}
          {' · '}
          <button type="button" onClick={() => onChange([])} className="underline hover:text-white">
            {t('clear')}
          </button>
        </p>
      )}
    </div>
  )
}
