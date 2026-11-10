'use client'

import { useTranslations } from 'next-intl'
import { marketDeadlineMismatch } from '@/lib/market-display'

/**
 * daatan#2141: a linked market that resolves more than a few days off this
 * forecast's own deadline is asking a different question in time — say so next
 * to the market. Renders nothing when the dates agree or either is unknown.
 * Dates use a fixed zone (not the viewer's) so SSR and CSR agree. A timestamp
 * at exactly 00:00:00Z is a date-only end date and is shown as that UTC date.
 * Any other time is read in US Eastern time, because Polymarket and Kalshi close
 * at end of day ET: "by Dec 31" arrives as 2027-01-01T04:59Z, which UTC would
 * show as "Jan 1".
 */
function formatMarketDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: d.getTime() % 86_400_000 === 0 ? 'UTC' : 'America/New_York',
  })
}

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
  const date = formatMarketDate(marketEndDate)
  return (
    <p className="mt-0.5 px-1 text-[11px] text-gray-500" data-testid="market-deadline-note">
      {mismatch === 'later' ? t('marketResolvesLater', { date }) : t('marketResolvesEarlier', { date })}
    </p>
  )
}
