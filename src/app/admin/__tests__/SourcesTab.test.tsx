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

  it('renders the summary and rows grouped by type, with status badges', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        total: 2,
        enabled: 1,
        sources: [
          { type: 'rss', name: 'Phys.org', locator: 'https://phys.org/rss-feed/', language: 'en', enabled: true },
          { type: 'youtube', name: 'BBC News', locator: 'UC123', language: 'en', enabled: false },
        ],
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
  })

  it('surfaces an error when the request fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({ error: 'News-indexer not configured' }) })
    renderWithIntl(<SourcesTab />)
    await waitFor(() => expect(screen.getByText('News-indexer not configured')).toBeInTheDocument())
  })
})
