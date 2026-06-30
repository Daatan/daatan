import { render, screen, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { NextIntlClientProvider } from 'next-intl'
import ForecastDetailClient from '../ForecastDetailClient'
import enMessages from '../../../../../messages/en.json'

vi.mock('next-auth/react', () => ({ useSession: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: 'pred-1' }),
}))
vi.mock('@/components/forecasts/Speedometer', () => ({ default: () => null }))
vi.mock('@/components/comments/CommentThread', () => ({ default: () => null }))
vi.mock('@/components/forecasts/CommitmentForm', () => ({ default: () => null }))
vi.mock('@/components/forecasts/CUBalanceIndicator', () => ({ default: () => null }))
vi.mock('@/components/forecasts/ContextTimeline', () => ({ default: () => null }))
vi.mock('../ModeratorResolutionSection', () => ({ ModeratorResolutionSection: () => null }))
vi.mock('../_forecast/SimilarForecasts', () => ({ SimilarForecasts: () => null }))

const RESOLVE_BY = '2026-04-16T23:59:59.000Z'

const makePrediction = () => ({
  id: 'pred-1',
  claimText: 'Test claim',
  detailsText: '',
  outcomeType: 'BINARY',
  status: 'ACTIVE',
  resolveByDatetime: RESOLVE_BY,
  author: { id: 'u1', name: 'User', username: 'user', image: null, rs: 100, role: 'USER' },
  options: [],
  commitments: [],
  totalCuCommitted: 0,
  isPublic: true,
  shareToken: 'token',
})

const wrap = (ui: React.ReactElement) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>
)

const globalFetch = global.fetch
afterEach(() => { global.fetch = globalFetch })

describe('ForecastDetailClient — Deadline panel', () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as any)
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePrediction(),
    })
  })

  it('renders the Resolution date label', async () => {
    await act(async () => {
      render(wrap(<ForecastDetailClient initialData={makePrediction() as any} />))
    })
    // The translation key is 'deadline' but its value is 'Resolution date'
    const labels = await screen.findAllByText(/resolution date/i)
    expect(labels.length).toBeGreaterThan(0)
  })

  it('shows a non-empty formatted date in the SSR render (no mount gate)', async () => {
    await act(async () => {
      render(wrap(<ForecastDetailClient initialData={makePrediction() as any} />))
    })

    // The date is rendered synchronously (UTC-stable), so it's in the initial
    // HTML for crawlers — the year 2026 must appear in the deadline panel.
    const matches = screen.getAllByText(/2026/)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('deadline text includes a UTC timezone token (hydration-stable)', async () => {
    await act(async () => {
      render(wrap(<ForecastDetailClient initialData={makePrediction() as any} />))
    })

    // formatDisplayDateTime pins timeZone: 'UTC' + timeZoneName: 'short' → "UTC",
    // identical on server and client (no hydration mismatch).
    const fullText = document.body.textContent ?? ''
    expect(fullText).toMatch(/UTC/)
  })
})
