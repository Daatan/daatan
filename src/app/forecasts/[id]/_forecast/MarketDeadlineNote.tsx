'use client'

import { useTranslations } from 'next-intl'
import { marketDeadlineMismatch } from '@/lib/market-display'
import { formatDisplayDate } from '@/lib/utils/date'

/**
 * daatan#2141: a linked market that resolves more than a few days off this
 * forecast's own deadline is asking a different question in time — say so next
 * to the market. Renders nothing when the dates agree or either is unknown.
 * Date formatting is UTC-pinned (formatDisplayDate) so SSR and CSR agree.
 */
export function MarketDeadlineNote({
  marketEndDate,
  claimDeadline,
}: {
  marketEndDate?: string | null
  claimDeadline?: string | null
}) {
  const t = useTranslations('forecast')
  const mismatch = marketDeadlineMismatch(marketEndDate, claimDeadline)
  if (mismatch === null || !marketEndDate) return null
  const date = formatDisplayDate(marketEndDate)
  return (
    <p className="mt-0.5 px-1 text-[11px] text-gray-500" data-testid="market-deadline-note">
      {mismatch === 'later' ? t('marketResolvesLater', { date }) : t('marketResolvesEarlier', { date })}
    </p>
  )
}
