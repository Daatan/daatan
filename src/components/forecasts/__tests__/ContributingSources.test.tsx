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

  it('splits sources into will / won\'t / neutral columns with counts', () => {
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
    expect(screen.getByText(/^Will happen \(1\)$/)).toBeInTheDocument()
    expect(screen.getByText(/^Won't happen \(1\)$/)).toBeInTheDocument()
    expect(screen.getByText(/^Neutral \/ unclear \(1\)$/)).toBeInTheDocument()
  })

  it('shows a press-lean summary from the stances', () => {
    // Two YES (certainty 0.5 → P(YES) 0.75 each) and one NO (0.75 → 0.125):
    // mean ≈ 0.54 → leans toward "will happen".
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://a.com/1', stance: 0.6, certainty: 0.5 }),
          src({ url: 'https://b.com/2', stance: 0.6, certainty: 0.5 }),
          src({ url: 'https://c.com/3', stance: -0.6, certainty: 0.75 }),
        ]}
      />,
    )
    expect(screen.getByText(/Press leans toward 'will happen' · \d+%/)).toBeInTheDocument()
  })

  it('shows the outlet name, its headline, and an aggregate side badge', () => {
    // Single-article outlet → a plain link card. stance 0.5, certainty 0.72 →
    // implied P(will) 0.86 → aggregate badge "↑ 86%" (the will/won't word is dropped;
    // the arrow + colour + column carry the side).
    renderWithIntl(
      <ContributingSources
        sources={[src({ source: 'Reuters', title: 'Big scoop', certainty: 0.72, stance: 0.5 })]} />,
    )
    expect(screen.getByText('Reuters')).toBeInTheDocument()
    expect(screen.getByText('Big scoop')).toBeInTheDocument()
    expect(screen.getByText('↑ 86%')).toBeInTheDocument()
  })

  it('falls back to the outlet host when there is no source name', () => {
    renderWithIntl(
      <ContributingSources sources={[src({ source: null, url: 'https://www.aljazeera.com/x', stance: 0.5 })]} />,
    )
    expect(screen.getByText('aljazeera.com')).toBeInTheDocument()
  })

  it('groups multiple articles from one outlet into a single expandable card', () => {
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://thehill.com/a', source: 'The Hill', title: 'First piece', stance: 0.5 }),
          src({ url: 'https://thehill.com/b', source: 'The Hill', title: 'Second piece', stance: 0.4 }),
        ]}
      />,
    )
    // Both articles lean YES → one outlet in the WILL column, not two cards.
    expect(screen.getByText(/^Will happen \(1\)$/)).toBeInTheDocument()
    expect(screen.getByText('The Hill')).toBeInTheDocument()
    // <details> renders its children in the DOM even while collapsed.
    expect(screen.getByText('First piece')).toBeInTheDocument()
    expect(screen.getByText('Second piece')).toBeInTheDocument()
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
    expect(screen.getByText(/^Will happen \(1\)$/)).toBeInTheDocument()
  })

  it("uses the outlet's most decisive article for the badge, not a diluted average or bare certainty", () => {
    // Mirrors a real case: a clearly on-topic YES article (stance .724, certainty
    // .725) shares a domain with an unrelated article that has HIGHER raw certainty
    // but a much weaker stance magnitude (stance -.208, certainty .78). Averaging
    // would cancel the strong signal down to "neutral"; picking by certainty alone
    // would pick the wrong (irrelevant) article. Signal strength (|stance| ×
    // certainty) correctly picks the on-topic one.
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://jpost.com/a', source: 'jpost.com', title: 'Decisive on-topic story', stance: 0.724, certainty: 0.725 }),
          src({ url: 'https://jpost.com/b', source: 'jpost.com', title: 'Unrelated off-topic story', stance: -0.208, certainty: 0.78 }),
        ]}
      />,
    )
    expect(screen.getByText(/^Will happen \(1\)$/)).toBeInTheDocument()
    expect(screen.getByText('↑ 86%')).toBeInTheDocument()
  })

  it('mentions gate-rejected articles by count instead of giving them a voter card', () => {
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://a.com/1', stance: 0.6 }),
          src({ url: 'https://b.com/2', stance: null, certainty: null }),
          src({ url: 'https://c.com/3', stance: null, certainty: null }),
        ]}
      />,
    )
    // Only the stance-scored article gets a voter card...
    expect(screen.getByText(/^Will happen \(1\)$/)).toBeInTheDocument()
    // ...the two gate-rejected ones are a passing count, not their own column entries.
    expect(screen.getByText('+2 articles matched but not used by the AI')).toBeInTheDocument()
    expect(screen.queryByText(/^Neutral \/ unclear/)).toBeNull()
  })

  it('uses the singular form for exactly one not-used article', () => {
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://a.com/1', stance: 0.6 }),
          src({ url: 'https://b.com/2', stance: null }),
        ]}
      />,
    )
    expect(screen.getByText('+1 article matched but not used by the AI')).toBeInTheDocument()
  })

  it('shows only a not-used count when every matched article was gate-rejected', () => {
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://a.com/1', stance: null }),
          src({ url: 'https://b.com/2', stance: null }),
        ]}
      />,
    )
    expect(screen.getByText(enMessages.sources.title)).toBeInTheDocument()
    expect(screen.getByText('+2 articles matched but not used by the AI')).toBeInTheDocument()
    expect(screen.queryByText(/^Will happen/)).toBeNull()
  })
})
