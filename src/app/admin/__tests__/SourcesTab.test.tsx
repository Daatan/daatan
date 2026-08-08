import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import SourcesTab from '../SourcesTab'
import enMessages from '../../../../messages/en.json'

const renderWithIntl = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )

const mockFetch = vi.fn()

describe('SourcesTab', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = mockFetch
  })

  it('renders the summary and rows grouped by type, with status badges and impact', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        total: 2,
        enabled: 1,
        sources: [
          { type: 'rss', name: 'Phys.org', locator: 'https://phys.org/rss-feed/', language: 'en', enabled: true,
            domain: 'phys.org', impact: { matches: 7, forecastsAffected: 5, last30dMatches: 2, lastMatchedAt: '2026-06-22T00:00:00+00:00' } },
          { type: 'youtube', name: 'BBC News', locator: 'UC123', language: 'en', enabled: false,
            domain: null, impact: { matches: 0, forecastsAffected: 0, last30dMatches: 0, lastMatchedAt: null } },
        ],
        unconfigured: [],
      }),
    })

    renderWithIntl(<SourcesTab />)

    await waitFor(() => expect(screen.getByText('Phys.org')).toBeInTheDocument())
    expect(screen.getByText('1 of 2 sources enabled')).toBeInTheDocument()
    expect(screen.getByText('BBC News')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
    // RSS locator renders as a link; youtube channel id as plain text.
    expect(screen.getByRole('link', { name: /phys\.org\/rss-feed/ })).toBeInTheDocument()
    // The outlet name itself links to its admin detail page.
    expect(screen.getByRole('link', { name: 'Phys.org' })).toHaveAttribute('href', '/admin/sources/Phys.org')
    expect(screen.getByRole('link', { name: 'BBC News' })).toHaveAttribute('href', '/admin/sources/BBC%20News')
    // Impact: Phys.org shows its forecast count + 30d badge; the un-measurable youtube row shows n/a.
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('2 in 30d')).toBeInTheDocument()
    expect(screen.getByText('n/a')).toBeInTheDocument()
  })

  it('shows the disabledReason under the Disabled badge', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        total: 2,
        enabled: 1,
        sources: [
          { type: 'rss', name: 'Phys.org', locator: 'https://phys.org/rss-feed/', language: 'en', enabled: true,
            domain: 'phys.org', disabledReason: null, impact: { matches: 1, forecastsAffected: 1, last30dMatches: 0, lastMatchedAt: null } },
          { type: 'rss', name: 'Reuters World', locator: 'https://x/r', language: 'en', enabled: false,
            domain: 'x', disabledReason: 'DNS failing from eu-central-1', impact: { matches: 0, forecastsAffected: 0, last30dMatches: 0, lastMatchedAt: null } },
        ],
        unconfigured: [],
      }),
    })

    renderWithIntl(<SourcesTab />)

    await waitFor(() => expect(screen.getByText('Reuters World')).toBeInTheDocument())
    expect(screen.getByText('DNS failing from eu-central-1')).toBeInTheDocument()
  })

  it('shows "shared with" instead of a duplicated number for sibling feeds of one outlet', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        total: 2,
        enabled: 2,
        sources: [
          { type: 'rss', name: 'BBC Middle East', locator: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', language: 'en', enabled: true,
            domain: 'feeds.bbci.co.uk', impact: { matches: 12, forecastsAffected: 7, last30dMatches: 12, lastMatchedAt: '2026-06-22T00:00:00+00:00', sharedWith: null } },
          { type: 'rss', name: 'BBC Russian', locator: 'https://feeds.bbci.co.uk/russian/rss.xml', language: 'ru', enabled: true,
            domain: 'feeds.bbci.co.uk', impact: { matches: 0, forecastsAffected: 0, last30dMatches: 0, lastMatchedAt: null, sharedWith: 'BBC Middle East' } },
        ],
        unconfigured: [],
      }),
    })

    renderWithIntl(<SourcesTab />)

    await waitFor(() => expect(screen.getByText('BBC Russian')).toBeInTheDocument())
    // The owner shows the real number; the sibling shows "shared with …", not a duplicate 7.
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('shared with BBC Middle East')).toBeInTheDocument()
    expect(screen.queryAllByText('7')).toHaveLength(1)
  })

  it('renders the "suggested sources to add" section from unconfigured domains', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        total: 1,
        enabled: 1,
        sources: [
          { type: 'rss', name: 'Phys.org', locator: 'https://phys.org/rss-feed/', language: 'en', enabled: true,
            domain: 'phys.org', impact: { matches: 1, forecastsAffected: 1, last30dMatches: 0, lastMatchedAt: null } },
        ],
        unconfigured: [
          { domain: 'apnews.com', matches: 9, forecastsAffected: 6, last30dMatches: 3, lastMatchedAt: '2026-06-21T00:00:00+00:00' },
        ],
      }),
    })

    renderWithIntl(<SourcesTab />)

    await waitFor(() => expect(screen.getByText('Suggested sources to add (1)')).toBeInTheDocument())
    const link = screen.getByRole('link', { name: /apnews\.com/ })
    expect(link).toHaveAttribute('href', 'https://apnews.com')
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('renders extraction yield and endorsement columns, including for Telegram rows with a null domain', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        total: 2,
        enabled: 2,
        sources: [
          { type: 'rss', name: 'Phys.org', locator: 'https://phys.org/rss-feed/', language: 'en', enabled: true,
            domain: 'phys.org', impact: { matches: 1, forecastsAffected: 1, last30dMatches: 0, lastMatchedAt: null },
            extraction: { complete: 3, failed: 1, yield: 0.75 },
            endorsement: { judged: 20, delivered: 5, rate: 0.25, judged30d: 4, delivered30d: 1, lastJudgedAt: '2026-08-01T00:00:00+00:00' } },
          { type: 'telegram', name: 'Edy Cohen', locator: 'edycohen', language: 'he', enabled: true,
            domain: null,
            extraction: { complete: 2, failed: 0, yield: 1 },
            endorsement: { judged: 8, delivered: 8, rate: 1, judged30d: 2, delivered30d: 2, lastJudgedAt: null } },
        ],
        unconfigured: [],
      }),
    })

    renderWithIntl(<SourcesTab />)

    await waitFor(() => expect(screen.getByText('Phys.org')).toBeInTheDocument())
    expect(screen.getByText('3/4')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText('20 judged')).toBeInTheDocument()
    // The Telegram row has domain null but must still show both metrics.
    expect(screen.getByText('2/2')).toBeInTheDocument()
    expect(screen.getAllByText('100%')).toHaveLength(2)
    expect(screen.getByText('8 judged')).toBeInTheDocument()
  })

  it('shows em dashes for a null yield and a missing endorsement block (ni side not yet deployed)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        total: 1,
        enabled: 1,
        sources: [
          { type: 'rss', name: 'Phys.org', locator: 'https://phys.org/rss-feed/', language: 'en', enabled: true,
            domain: 'phys.org', impact: { matches: 1, forecastsAffected: 1, last30dMatches: 0, lastMatchedAt: null },
            extraction: { complete: 0, failed: 0, yield: null } },
        ],
        unconfigured: [],
      }),
    })

    renderWithIntl(<SourcesTab />)

    await waitFor(() => expect(screen.getByText('Phys.org')).toBeInTheDocument())
    // Exactly two em dashes: the yield cell and the endorsement cell.
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('shows an em dash for an endorsement block with judged=0', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        total: 1,
        enabled: 1,
        sources: [
          { type: 'rss', name: 'Phys.org', locator: 'https://phys.org/rss-feed/', language: 'en', enabled: true,
            domain: 'phys.org', impact: { matches: 1, forecastsAffected: 1, last30dMatches: 0, lastMatchedAt: null },
            extraction: { complete: 4, failed: 0, yield: 1 },
            endorsement: { judged: 0, delivered: 0, rate: null, judged30d: 0, delivered30d: 0, lastJudgedAt: null } },
        ],
        unconfigured: [],
      }),
    })

    renderWithIntl(<SourcesTab />)

    await waitFor(() => expect(screen.getByText('4/4')).toBeInTheDocument())
    expect(screen.getAllByText('—')).toHaveLength(1)
  })

  it('surfaces an error when the request fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({ error: 'News-indexer not configured' }) })
    renderWithIntl(<SourcesTab />)
    await waitFor(() => expect(screen.getByText('News-indexer not configured')).toBeInTheDocument())
  })
})
