import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import OutletDetailPanel from '../OutletDetailPanel'
import enMessages from '../../../../../../messages/en.json'

vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const renderWithIntl = (ui: React.ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  )

const mockFetch = vi.fn()

const baseDetail = {
  name: 'Reuters',
  wikipediaUrl: null,
  telegramChannel: null,
  links: [],
  notes: null,
  sourceConfig: { type: 'rss', locator: 'https://feeds.reuters.com/reuters/topNews', language: 'en', enabled: true, domain: 'feeds.reuters.com' },
  impact: { matches: 12, forecastsAffected: 5, last30dMatches: 3, lastMatchedAt: '2026-07-01T00:00:00+00:00' },
  publications: [],
  linkedPeople: [],
}

describe('OutletDetailPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    global.fetch = mockFetch
  })

  it('renders identity, config summary, and impact numbers', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(baseDetail) })
    renderWithIntl(<OutletDetailPanel name="Reuters" />)

    await waitFor(() => expect(screen.getByText('Reuters')).toBeInTheDocument())
    expect(screen.getByText(/rss/)).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument() // forecastsAffected
    expect(screen.getByText('12')).toBeInTheDocument() // matches
  })

  it('shows the "not configured" notice when sourceConfig is null', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ...baseDetail, sourceConfig: null }) })
    renderWithIntl(<OutletDetailPanel name="Renamed Outlet" />)

    await waitFor(() => expect(screen.getByText('Not configured in sources.yaml')).toBeInTheDocument())
  })

  it('pre-fills the edit form from existing enrichment', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ...baseDetail,
        wikipediaUrl: 'https://en.wikipedia.org/wiki/Reuters',
        telegramChannel: 'reuters_tg',
        notes: 'Wire service',
      }),
    })
    renderWithIntl(<OutletDetailPanel name="Reuters" />)

    await waitFor(() => expect(screen.getByDisplayValue('https://en.wikipedia.org/wiki/Reuters')).toBeInTheDocument())
    expect(screen.getByDisplayValue('reuters_tg')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Wire service')).toBeInTheDocument()
  })

  it('saves edited fields via PUT with the correct body', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(baseDetail) })
    renderWithIntl(<OutletDetailPanel name="Reuters" />)
    await waitFor(() => expect(screen.getByText('Reuters')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('https://en.wikipedia.org/wiki/...'), {
      target: { value: 'https://en.wikipedia.org/wiki/Reuters' },
    })

    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ...baseDetail, wikipediaUrl: 'https://en.wikipedia.org/wiki/Reuters' }) })
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ ...baseDetail, wikipediaUrl: 'https://en.wikipedia.org/wiki/Reuters' }) })
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
      '/api/admin/news-indexer/sources/Reuters',
      expect.objectContaining({ method: 'PUT' }),
    ))
    const putCall = mockFetch.mock.calls.find(([, opts]) => opts?.method === 'PUT')
    const body = JSON.parse(putCall![1].body)
    expect(body.wikipedia_url).toBe('https://en.wikipedia.org/wiki/Reuters')
  })

  it('shows the no-linked-people hint when nobody is linked', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(baseDetail) })
    renderWithIntl(<OutletDetailPanel name="Reuters" />)

    await waitFor(() => expect(screen.getByText('No people linked to this outlet yet.')).toBeInTheDocument())
  })

  it('renders linked people as read-only badges', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ...baseDetail,
        linkedPeople: [{ id: 'p1', canonicalName: 'Jane Reporter' }],
      }),
    })
    renderWithIntl(<OutletDetailPanel name="Reuters" />)

    await waitFor(() => expect(screen.getByText('Jane Reporter')).toBeInTheDocument())
    expect(screen.queryByText('No people linked to this outlet yet.')).not.toBeInTheDocument()
  })

  it('renders publications with a link to the forecast', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ...baseDetail,
        publications: [
          { title: 'Reuters story', url: 'https://reuters.com/a', source: 'reuters.com', publishedAt: null, pushedAt: null, forecastId: 'pred-1', outcome: null },
        ],
      }),
    })
    renderWithIntl(<OutletDetailPanel name="Reuters" />)

    await waitFor(() => expect(screen.getByText('Reuters story')).toBeInTheDocument())
    const forecastLink = screen.getByRole('link', { name: 'Forecast' })
    expect(forecastLink).toHaveAttribute('href', '/forecasts/pred-1')
  })
})
