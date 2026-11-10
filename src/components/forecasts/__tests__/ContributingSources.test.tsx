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
  personName: null,
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
    // Two YES (stance .6 → P(YES) 0.8 each) and one NO (stance −.6 → 0.2):
    // mean 0.6 → leans toward "will happen" at 60%. Certainty does not move it.
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://a.com/1', stance: 0.6, certainty: 0.5 }),
          src({ url: 'https://b.com/2', stance: 0.6, certainty: 0.5 }),
          src({ url: 'https://c.com/3', stance: -0.6, certainty: 0.75 }),
        ]}
      />,
    )
    expect(screen.getByText("Press leans toward 'will happen' · 60%")).toBeInTheDocument()
  })

  it('shows the outlet name, its headline, and an aggregate side badge', () => {
    // Single-article outlet → a plain link card. stance 0.5, certainty 0.72 →
    // badge shows implied P(YES) = (1 + 0.5)/2 = 75% — the vote the Oracul pool
    // casts for it (#2139). The will/won't word is dropped; the arrow + colour +
    // column carry the side. One scale everywhere (#1249): neither raw 72%
    // certainty nor the old certainty-derived 86%.
    renderWithIntl(
      <ContributingSources
        sources={[src({ source: 'Reuters', title: 'Big scoop', certainty: 0.72, stance: 0.5 })]} />,
    )
    expect(screen.getByText('Reuters')).toBeInTheDocument()
    expect(screen.getByText('Big scoop')).toBeInTheDocument()
    expect(screen.getByText('↑ 75%')).toBeInTheDocument()
    expect(screen.queryByText('↑ 86%')).toBeNull()
  })

  it('derives each badge from stance, not certainty — the panel agrees with the pooled estimate (#2139)', () => {
    // Real rows from the Knesset Speaker forecast (2026-11-10, Oracul 62%): a ynet
    // article at stance +0.30 / certainty 0.75 showed ↑88% while voting 65% in the
    // pool. Same stance at a lower certainty must show the same number — certainty
    // is the vote's weight, not its location.
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://ynet.co.il/a', source: 'ynet.co.il', title: 'High certainty', stance: 0.3, certainty: 0.75 }),
          src({ url: 'https://srugim.co.il/b', source: 'srugim.co.il', title: 'Low certainty', stance: 0.3, certainty: 0.3 }),
        ]}
      />,
    )
    expect(screen.getAllByText('↑ 65%').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('↑ 88%')).toBeNull()
    expect(screen.getByText("Press leans toward 'will happen' · 65%")).toBeInTheDocument()
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
    // P(YES) ((1 + .724)/2 → 86%) — the same number its own row shows (#1249).
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
    // A: stance .6  → P(YES) 80%, signalStrength .54 (the lead)
    // B: stance −.6 → P(YES) 20%, signalStrength .18
    // C: stance .1 (neutral band, no number on its badge) → P(YES) 55% in the range
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
    // and the badge number (80%) IS the range's upper endpoint, the literal
    // correspondence #1249 was filed about.
    expect(screen.getAllByText('↑ 80%')).toHaveLength(2)
    const range = screen.getByText('20–80%')
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

  it('links a confirmed byline on a single-article card to its /authors/[author]/[outlet] profile (#1213)', () => {
    renderWithIntl(
      <ContributingSources
        sources={[src({ source: 'Reuters', outletName: 'reuters', personName: 'Jane Doe', authorLinkable: true, stance: 0.5 })]}
      />,
    )
    const link = screen.getByText('Jane Doe').closest('a')
    expect(link).toHaveAttribute('href', '/authors/Jane%20Doe/reuters')
  })

  it('shows no byline link when the (author, outlet) pair is not confirmed on the leaderboard', () => {
    // personName resolved but authorLinkable unset → the profile page would 404, so no link
    // (the byline stays tooltip-only, exactly as before #1213).
    renderWithIntl(
      <ContributingSources
        sources={[src({ source: 'Reuters', outletName: 'reuters', personName: 'Jane Doe', stance: 0.5 })]}
      />,
    )
    expect(screen.queryByText('Jane Doe')).toBeNull()
  })

  it('links confirmed bylines on expanded multi-article rows, next to the article link', () => {
    renderWithIntl(
      <ContributingSources
        sources={[
          src({ url: 'https://thehill.com/a', source: 'The Hill', outletName: 'the-hill', personName: 'Ann A', authorLinkable: true, title: 'First', stance: 0.5 }),
          src({ url: 'https://thehill.com/b', source: 'The Hill', outletName: 'the-hill', title: 'Second', stance: 0.4 }),
        ]}
      />,
    )
    // Confirmed byline → profile link; the article link itself must survive as a sibling.
    expect(screen.getByText('Ann A').closest('a')).toHaveAttribute('href', '/authors/Ann%20A/the-hill')
    expect(screen.getByText('First').closest('a')).toHaveAttribute('href', 'https://thehill.com/a')
    // The unconfirmed row keeps its plain full-row article anchor.
    expect(screen.getByText('Second').closest('a')).toHaveAttribute('href', 'https://thehill.com/b')
  })

  // Settlement pin (#1250): the sources that reported the outcome as decided are
  // flagged, so a bad pin is diagnosable from the page.
  describe('settling-source flag', () => {
    it('flags a single-article outlet whose article is settled', () => {
      renderWithIntl(
        <ContributingSources
          sources={[
            src({ url: 'https://rferl.org/1', source: 'RFE/RL', stance: 0.8, settled: true }),
            src({ url: 'https://reuters.com/2', source: 'Reuters', stance: 0.5, settled: false }),
          ]}
        />,
      )
      expect(screen.getAllByTestId('settling-source-flag')).toHaveLength(1)
      expect(screen.getByText(enMessages.sources.settledBadge)).toBeInTheDocument()
    })

    it('shows no flag when settled is false or absent', () => {
      renderWithIntl(
        <ContributingSources
          sources={[
            src({ url: 'https://a.com/1', stance: 0.6, settled: false }),
            src({ url: 'https://b.com/2', stance: -0.6, settled: null }),
            src({ url: 'https://c.com/3', stance: 0.3 }),
          ]}
        />,
      )
      expect(screen.queryByTestId('settling-source-flag')).not.toBeInTheDocument()
    })

    it('flags a multi-article outlet card on its summary and on the settling row', () => {
      renderWithIntl(
        <ContributingSources
          sources={[
            src({ url: 'https://thehill.com/a', source: 'The Hill', title: 'Decided piece', stance: 0.8, certainty: 0.9, settled: true }),
            src({ url: 'https://thehill.com/b', source: 'The Hill', title: 'Ordinary piece', stance: 0.4, certainty: 0.5, settled: false }),
          ]}
        />,
      )
      // One flag on the collapsed summary + one on the settled article's row.
      expect(screen.getAllByTestId('settling-source-flag')).toHaveLength(2)
    })
  })
})
