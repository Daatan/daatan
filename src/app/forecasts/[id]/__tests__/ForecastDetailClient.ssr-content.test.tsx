import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { NextIntlClientProvider } from 'next-intl'
import ForecastDetailClient from '../ForecastDetailClient'
import enMessages from '../../../../../messages/en.json'

// The point of these tests: the substantive forecast content must be present in
// the rendered HTML *without* any user interaction, so crawlers see it and stop
// flagging the page as a thin-content "Soft 404".

vi.mock('next-auth/react', () => ({ useSession: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: 'pred-1' }),
}))
vi.mock('@/components/forecasts/Speedometer', () => ({ default: () => null }))
vi.mock('@/components/comments/CommentThread', () => ({ default: () => null }))
vi.mock('@/components/forecasts/ContextTimeline', () => ({ default: () => null }))
vi.mock('../ModeratorResolutionSection', () => ({ ModeratorResolutionSection: () => null }))
vi.mock('../_forecast/SimilarForecasts', () => ({ SimilarForecasts: () => null }))

const makePrediction = (over: Record<string, unknown> = {}) => ({
  id: 'pred-1',
  claimText: 'It will not rain in Ramat-Gan on February 26, 2026.',
  detailsText: '',
  resolutionRules: 'Resolves YES if the official forecast records zero precipitation.',
  outcomeType: 'BINARY',
  status: 'ACTIVE',
  createdAt: '2026-02-01T08:00:00.000Z',
  resolveByDatetime: '2026-02-26T23:59:59.000Z',
  author: { id: 'u1', name: 'Mark', username: 'mark', image: null, rs: 120, role: 'USER' },
  options: [],
  commitments: [],
  totalCuCommitted: 0,
  isPublic: true,
  shareToken: 'token',
  ...over,
})

const wrap = (ui: React.ReactElement) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>
)

const globalFetch = global.fetch
afterEach(() => { global.fetch = globalFetch })

describe('ForecastDetailClient — SSR substantive content (anti soft-404)', () => {
  beforeEach(() => {
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as never)
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => makePrediction() })
  })

  it('renders the server-side facts line with author, dates and status', async () => {
    await act(async () => {
      render(wrap(<ForecastDetailClient initialData={makePrediction() as never} />))
    })
    const body = document.body.textContent ?? ''
    expect(body).toContain('Forecast by Mark')
    expect(body).toContain('opened Feb 1, 2026')
    expect(body).toContain('resolves Feb 26, 2026')
    expect(body).toContain('open for forecasts')
  })

  it('reports the resolved outcome in the facts line', async () => {
    const resolved = makePrediction({
      status: 'RESOLVED_CORRECT', resolvedAt: '2026-02-27T00:00:00.000Z', resolutionOutcome: 'correct',
    })
    // The component re-fetches on mount; return the same resolved view-model.
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => resolved })
    await act(async () => {
      render(wrap(<ForecastDetailClient initialData={resolved as never} />))
    })
    expect(document.body.textContent ?? '').toContain('resolved correct')
  })

  it('keeps the resolution rules in the DOM while collapsed (crawlable)', async () => {
    await act(async () => {
      render(wrap(<ForecastDetailClient initialData={makePrediction() as never} />))
    })
    // The toggle starts collapsed, but the text must still be in the HTML.
    expect(screen.getByText(/zero precipitation/)).toBeInTheDocument()
  })
})
