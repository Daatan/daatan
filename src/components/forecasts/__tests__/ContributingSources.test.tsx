import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ContributingSources } from '../ContributingSources'
import type { ContributingSource } from '@/lib/services/forecast-sources'
import enMessages from '../../../../messages/en.json'

const renderWithIntl = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )

const src = (over: Partial<ContributingSource>): ContributingSource => ({
  url: 'https://example.com/a',
  title: 'A headline',
  source: 'Reuters',
  author: null,
  publishedAt: null,
  similarity: 0.8,
  stance: 0,
  certainty: 0.5,
  claim: null,
  oracleProbability: null,
  outcome: null,
  ...over,
})

describe('ContributingSources', () => {
  it('renders nothing when there are no sources', () => {
    const { container } = renderWithIntl(<ContributingSources sources={[]} />)
    expect(container.querySelector('[data-testid="contributing-sources"]')).toBeNull()
  })

  it('groups sources by stance and shows the section title', () => {
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://a.com/1', source: 'Reuters', stance: 0.6 }),
          src({ url: 'https://b.com/2', source: 'BBC', stance: -0.6 }),
          src({ url: 'https://c.com/3', source: 'AP', stance: 0 }),
        ]}
      />,
    )
    expect(screen.getByText(enMessages.sources.title)).toBeInTheDocument()
    expect(screen.getByText(/Favors YES \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Favors NO \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Neutral \(1\)/)).toBeInTheDocument()
  })

  it('shows the author and certainty when present', () => {
    renderWithIntl(
      <ContributingSources sources={[src({ author: 'Jane Doe', certainty: 0.72, stance: 0.5 })]} />,
    )
    expect(screen.getByText('by Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('72% certainty')).toBeInTheDocument()
  })

  it('dedupes repeated article URLs', () => {
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://dup.com/x', source: 'Dup', stance: 0.5 }),
          src({ url: 'https://dup.com/x', source: 'Dup', stance: 0.5 }),
        ]}
      />,
    )
    // One publication after dedup.
    expect(screen.getByText(/Favors YES \(1\)/)).toBeInTheDocument()
  })
})
