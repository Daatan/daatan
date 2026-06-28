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

  it('surfaces an error when the request fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({ error: 'News-indexer not configured' }) })
    renderWithIntl(<SourcesTab />)
    await waitFor(() => expect(screen.getByText('News-indexer not configured')).toBeInTheDocument())
  })
})
