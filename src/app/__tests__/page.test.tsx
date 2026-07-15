import { render, screen, waitFor, act } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import FeedClient from '../FeedClient'
import { generateMetadata } from '../page'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import messages from '../../../messages/en.json'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock ForecastCard to simplify testing
vi.mock('@/components/forecasts/ForecastCard', () => ({
  default: () => <div data-testid="prediction-card">Card</div>
}))

const renderWithIntl = (ui: React.ReactElement) =>
  render(<NextIntlClientProvider locale="en" messages={messages}>{ui}</NextIntlClientProvider>)

describe('FeedPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockReset()
  })

  it('renders skeleton cards in loading state', async () => {
    // Return a promise that doesn't resolve immediately to catch the loading state
    let resolveFetch: (value: any) => void
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve
    })
    
    mockFetch.mockReturnValue(fetchPromise)
    
    renderWithIntl(<FeedClient />)
    
    // Skeleton cards are shown (5 skeleton cards) instead of a spinner
    const skeletons = screen.getAllByTestId('forecast-skeleton')
    expect(skeletons.length).toBeGreaterThan(0)

    // Settle the fetch to avoid act() warnings in subsequent tests or cleanup
    await act(async () => {
      resolveFetch!({
        ok: true,
        json: async () => ({ predictions: [] }),
      })
    })
  })

  it('renders predictions when API returns data', async () => {
    const mockPredictions = [{ id: '1', title: 'Test' }]
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ predictions: mockPredictions }),
    } as Response)

    renderWithIntl(<FeedClient />)

    await waitFor(() => {
      expect(screen.getByTestId('prediction-card')).toBeInTheDocument()
    })
  })

  it('handles empty API response gracefully (prevents crash)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ someOtherData: 'unexpected' }),
    } as Response)

    renderWithIntl(<FeedClient />)

    await waitFor(() => {
      // The component should stop showing skeletons/loading once the fetch settles
      expect(screen.queryByTestId('forecast-skeleton')).not.toBeInTheDocument()
    })

    expect(screen.getByText(messages.feed.empty)).toBeInTheDocument()
  })
})

describe('FeedPage generateMetadata', () => {
  it('returns no robots override for the default (unfiltered) view', async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) })

    expect(metadata.robots).toBeUndefined()
  })

  it.each([
    ['tags', { tags: 'Leadership' }],
    ['status', { status: 'ACTIVE' }],
    ['sortBy', { sortBy: 'trending' }],
  ])('returns noindex when the %s param is present', async (_label, params) => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve(params) })

    expect(metadata.robots).toEqual({ index: false, follow: false })
  })
})
