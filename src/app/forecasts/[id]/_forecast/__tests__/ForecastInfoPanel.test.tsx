import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import { ForecastInfoPanel } from '../ForecastInfoPanel'
import type { Prediction } from '../types'
import enMessages from '../../../../../../messages/en.json'

const basePrediction = {
  id: 'pred-1',
  isPublic: true,
  shareToken: 'token',
  claimText: 'Test claim',
  outcomeType: 'BINARY',
  status: 'ACTIVE',
  createdAt: '2026-03-01T08:00:00.000Z',
  resolveByDatetime: '2026-04-16T23:59:59.000Z',
  author: { id: 'u1', name: 'User', username: 'user', image: null, rs: 100, role: 'USER' },
} as unknown as Prediction

const wrap = (prediction: Prediction) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ForecastInfoPanel prediction={prediction} />
    </NextIntlClientProvider>,
  )

describe('ForecastInfoPanel — Creation date box', () => {
  it('renders the "Creation date" card above the resolution date', () => {
    wrap(basePrediction)
    expect(screen.getByText('Creation date')).toBeInTheDocument()
    expect(screen.getByText('Resolution date')).toBeInTheDocument()
  })

  it('renders both dates synchronously (no isMounted gate) in UTC for SSR', () => {
    wrap(basePrediction)
    // Both values are present on first render — they must be in the SSR HTML.
    expect(screen.getByText(/Mar 1, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Apr 16, 2026/)).toBeInTheDocument()
    // UTC-stable formatting (timeZone: 'UTC') so server and client agree.
    expect(screen.getAllByText(/UTC/).length).toBeGreaterThan(0)
  })
})

describe('ForecastInfoPanel — Tags box', () => {
  it('renders "None" when the forecast has an empty tags array', () => {
    // Regression: `[].map() || None` left a bare, empty Tags box because an
    // empty array is truthy. The fallback must fire on length 0 too.
    wrap({ ...basePrediction, tags: [] })
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('renders "None" when tags is undefined', () => {
    wrap({ ...basePrediction, tags: undefined })
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('renders the real topic tags as chips', () => {
    wrap({
      ...basePrediction,
      tags: [
        { id: 't1', name: 'Politics', slug: 'politics' },
        { id: 't2', name: 'Crypto', slug: 'crypto' },
      ],
    })
    expect(screen.getByText('Politics')).toBeInTheDocument()
    expect(screen.getByText('Crypto')).toBeInTheDocument()
    expect(screen.queryByText('None')).toBeNull()
  })
})

describe('ForecastInfoPanel — linked market card', () => {
  const withMarket = (url: string) =>
    ({
      ...basePrediction,
      externalMarket: {
        provider: 'POLYMARKET',
        slug: 'will-x-happen',
        url,
        question: 'Will X happen?',
        resolved: false,
        snapshots: [{ createdAt: '2026-06-01', probability: 62 }],
      },
    }) as unknown as Prediction

  it('shows a clickable "View on Polymarket" link to the market url', () => {
    wrap(withMarket('https://polymarket.com/event/will-x-happen'))
    const link = screen.getByText('View on Polymarket →').closest('a')
    expect(link).toHaveAttribute('href', 'https://polymarket.com/event/will-x-happen')
    expect(screen.getByText('62%')).toBeInTheDocument()
  })

  it('falls back to a slug-derived url when the stored url is empty', () => {
    wrap(withMarket(''))
    const link = screen.getByText('View on Polymarket →').closest('a')
    expect(link).toHaveAttribute('href', 'https://polymarket.com/event/will-x-happen')
  })

  it('shows no market card (and no link option) when not connected', () => {
    wrap(basePrediction)
    expect(screen.queryByText(/View on/)).toBeNull()
  })

  it('shows 100 − price and an "Inverted" badge when the link is inverted', () => {
    wrap({
      ...withMarket('https://polymarket.com/event/will-x-happen'),
      externalMarketInverted: true,
    } as unknown as Prediction)
    expect(screen.getByText('38%')).toBeInTheDocument()
    expect(screen.queryByText('62%')).toBeNull()
    const badge = screen.getByText('Inverted')
    expect(badge).toHaveAttribute('title', expect.stringContaining('opposite question'))
  })

  it('names the tracked outcome for a non-Yes/No market', () => {
    const p = withMarket('https://polymarket.com/event/will-x-happen')
    ;(p.externalMarket as { outcomes?: unknown }).outcomes = ['Knicks', 'Celtics']
    wrap(p)
    expect(screen.getByText('chance of “Knicks”')).toBeInTheDocument()
  })

  it('adds no polarity or outcome labels on a plain Yes/No link', () => {
    const p = withMarket('https://polymarket.com/event/will-x-happen')
    ;(p.externalMarket as { outcomes?: unknown }).outcomes = ['Yes', 'No']
    wrap(p)
    expect(screen.queryByText('Inverted')).toBeNull()
    expect(screen.queryByText(/chance of/)).toBeNull()
  })
})
