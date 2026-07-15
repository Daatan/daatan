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

  it('links each tag chip to its canonical /tags/[slug] page, not the ?tags= query param', () => {
    // Regression: linking to /?tags=name generated an empty-SSR, unindexed
    // shell for every tag combination (GSC Soft 404 bucket). /tags/[slug] is
    // the crawlable, canonicalized route.
    wrap({ ...basePrediction, tags: [{ id: 't1', name: 'Politics', slug: 'politics' }] })
    expect(screen.getByText('Politics').closest('a')).toHaveAttribute('href', '/tags/politics')
  })
})
