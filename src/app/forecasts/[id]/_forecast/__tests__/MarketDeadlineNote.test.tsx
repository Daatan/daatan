import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import { MarketDeadlineNote } from '../MarketDeadlineNote'
import enMessages from '../../../../../../messages/en.json'

const wrap = (marketEndDate: string | null | undefined, claimDeadline: string | null | undefined) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MarketDeadlineNote marketEndDate={marketEndDate} claimDeadline={claimDeadline} />
    </NextIntlClientProvider>,
  )

describe('MarketDeadlineNote (daatan#2141)', () => {
  it('says the market resolves later, with a UTC-formatted date', () => {
    // 23:30 UTC — would read as Jan 1 in a UTC+ zone if not pinned to UTC.
    wrap('2026-12-31T23:30:00Z', '2026-12-09T00:00:00Z')
    expect(screen.getByTestId('market-deadline-note')).toHaveTextContent(
      "Market resolves Dec 31, 2026 — later than this forecast's deadline",
    )
  })

  it('says the market resolves earlier', () => {
    wrap('2026-11-20T00:00:00Z', '2026-12-09T00:00:00Z')
    expect(screen.getByTestId('market-deadline-note')).toHaveTextContent(
      "Market resolves Nov 20, 2026 — earlier than this forecast's deadline",
    )
  })

  it('renders nothing within the 3-day tolerance', () => {
    wrap('2026-12-11T00:00:00Z', '2026-12-09T00:00:00Z')
    expect(screen.queryByTestId('market-deadline-note')).toBeNull()
  })

  it('renders nothing when either date is missing', () => {
    wrap(null, '2026-12-09T00:00:00Z')
    expect(screen.queryByTestId('market-deadline-note')).toBeNull()
    wrap('2026-12-31T00:00:00Z', null)
    expect(screen.queryByTestId('market-deadline-note')).toBeNull()
  })
})
