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
  outletName: null,
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
    // badge shows implied P(YES) = 0.5 + 0.72/2 = 86% (the will/won't word is
    // dropped; the arrow + colour + column carry the side). One scale everywhere
    // (#1249): NOT the article's raw 72% certainty.
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
    // certainty) correctly picks the on-topic one, and the badge shows ITS implied
    // P(YES) (0.5 + .725/2 → 86%) — the same number its own row shows (#1249).
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://jpost.com/a', source: 'jpost.com', title: 'Decisive on-topic story', stance: 0.724, certainty: 0.725 }),
          src({ url: 'https://jpost.com/b', source: 'jpost.com', title: 'Unrelated off-topic story', stance: -0.208, certainty: 0.78 }),
        ]}
      />,
    )
    expect(screen.getByText(/^Will happen \(1\)$/)).toBeInTheDocument()
    // Appears twice: the outlet-header badge and the lead article's own row badge
    // show the identical number — card and rows stay on the one shared scale.
    expect(screen.getAllByText('↑ 86%')).toHaveLength(2)
  })

  it("shows the outlet-wide P(YES) range next to the lead badge, on the same scale as the press-lean bar", () => {
    // Same domain, three articles the lead pct alone can't tell apart from:
    // A: yes, certainty .9 → P(YES) 95%, signalStrength .54 (the lead)
    // B: no,  certainty .3 → P(YES) 35%, signalStrength .18
    // C: stance .1 (neutral band) → P(YES) 50% regardless of its .9 certainty
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://outlet.com/a', source: 'outlet.com', title: 'A', stance: 0.6, certainty: 0.9 }),
          src({ url: 'https://outlet.com/b', source: 'outlet.com', title: 'B', stance: -0.6, certainty: 0.3 }),
          src({ url: 'https://outlet.com/c', source: 'outlet.com', title: 'C', stance: 0.1, certainty: 0.9 }),
        ]}
      />,
    )
    // Appears twice: the outlet-header badge and lead article A's own row badge —
    // and the badge number (95%) IS the range's upper endpoint, the literal
    // correspondence #1249 was filed about.
    expect(screen.getAllByText('↑ 95%')).toHaveLength(2)
    const range = screen.getByText('35–95%')
    expect(range).toHaveAttribute('title', 'Implied-probability range across 3 articles')
  })

  it('does not show a range on a single-article outlet — nothing to span', () => {
    renderWithIntl(
      <ContributingSources
        sources={[src({ source: 'Reuters', title: 'Solo piece', certainty: 0.72, stance: 0.5 })]}
      />,
    )
    expect(screen.queryByText(/^\d+–\d+%$/)).toBeNull()
  })

  it('hides gate-rejected articles entirely instead of giving them a voter card', () => {
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://a.com/1', stance: 0.6 }),
          src({ url: 'https://b.com/2', stance: null, certainty: null }),
          src({ url: 'https://c.com/3', stance: null, certainty: null }),
        ]}
      />,
    )
    // Only the stance-scored article gets a voter card; the gate-rejected ones vanish.
    expect(screen.getByText(/^Will happen \(1\)$/)).toBeInTheDocument()
    expect(screen.queryByText(/matched but not used/)).toBeNull()
    expect(screen.queryByText(/^Neutral \/ unclear/)).toBeNull()
  })

  it('renders nothing when every matched article was gate-rejected', () => {
    const { container } = renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://a.com/1', stance: null }),
          src({ url: 'https://b.com/2', stance: null }),
        ]}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('links a single-article outlet name to its /sources/[name] profile when resolved', () => {
    renderWithIntl(
      <ContributingSources
        sources={[src({ source: 'Reuters', outletName: 'reuters', stance: 0.5 })]}
      />,
    )
    const link = screen.getByText('Reuters').closest('a')
    expect(link).toHaveAttribute('href', '/sources/reuters')
  })

  it('renders the outlet name as plain text (no link) when outletName is unresolved', () => {
    renderWithIntl(
      <ContributingSources sources={[src({ source: 'Reuters', outletName: null, stance: 0.5 })]} />,
    )
    const name = screen.getByText('Reuters')
    expect(name.closest('a')).toBeNull()
  })

  it('links a multi-article outlet card name to its /sources/[name] profile when resolved', () => {
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://thehill.com/a', source: 'The Hill', outletName: 'the-hill', title: 'First', stance: 0.5 }),
          src({ url: 'https://thehill.com/b', source: 'The Hill', outletName: 'the-hill', title: 'Second', stance: 0.4 }),
        ]}
      />,
    )
    const link = screen.getByText('The Hill').closest('a')
    expect(link).toHaveAttribute('href', '/sources/the-hill')
  })

  it('URL-encodes the outlet name in the profile link', () => {
    renderWithIntl(
      <ContributingSources sources={[src({ source: 'Some/Outlet', outletName: 'some/outlet', stance: 0.5 })]} />,
    )
    const link = screen.getByText('Some/Outlet').closest('a')
    expect(link).toHaveAttribute('href', '/sources/some%2Foutlet')
  })
})
