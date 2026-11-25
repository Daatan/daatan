import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useSession } from 'next-auth/react'
import messages from '../../../../messages/en.json'

// daatan#2330: /forecasts (the sidebar's "Forecasts") gets the same topic chips and the same
// remembered selection as the home feed.

let params: Record<string, string> = {}
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  usePathname: () => '/forecasts',
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => params[k] ?? null }),
}))
vi.mock('@/components/forecasts/ForecastCard', () => ({ default: () => <div data-testid="prediction-card" /> }))

import { PredictionsPage } from '../PredictionsClient'
import type { Prediction } from '@/components/forecasts/ForecastCard'

const mockFetch = vi.fn()
global.fetch = mockFetch
const feedCalls = () => mockFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/api/forecasts'))

const ssr = [{ id: 'p1' }] as unknown as Prediction[]
const renderPage = () =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PredictionsPage initialPredictions={ssr} topicCounts={{ politics: 5, economy: 2 }} />
    </NextIntlClientProvider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ predictions: [] }) })
  localStorage.clear()
  params = {}
  vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as never)
})

describe('/forecasts topic chips (daatan#2330)', () => {
  it('shows the SSR page without fetching when nothing is selected', async () => {
    renderPage()
    expect(screen.getByRole('button', { name: 'Politics' })).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 0))
    expect(feedCalls()).toHaveLength(0)
  })

  it('applies the topics remembered on the home feed', async () => {
    localStorage.setItem('daatan_feed_tags', JSON.stringify(['Economy']))
    renderPage()
    await waitFor(() => expect(feedCalls().some((u) => u.includes('tags=Economy'))).toBe(true))
    expect(screen.getByTestId('topics-selected')).toHaveTextContent('1 topic')
  })

  it('picking a topic fetches it, remembers it, and keeps the search in the URL', async () => {
    params = { q: 'iran' }
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Politics' }))
    await waitFor(() => expect(feedCalls().some((u) => u.includes('q=iran') && u.includes('tags=Politics'))).toBe(true))
    expect(replace).toHaveBeenLastCalledWith('/forecasts?q=iran&tags=Politics', { scroll: false })
    expect(JSON.parse(localStorage.getItem('daatan_feed_tags')!)).toEqual(['Politics'])
  })

  it('a ?tags= link filters without overwriting the remembered topics', async () => {
    params = { tags: 'Economy' }
    localStorage.setItem('daatan_feed_tags', JSON.stringify(['Politics']))
    renderPage()
    await waitFor(() => expect(feedCalls().some((u) => u.includes('tags=Economy'))).toBe(true))
    expect(JSON.parse(localStorage.getItem('daatan_feed_tags')!)).toEqual(['Politics'])
  })
})
