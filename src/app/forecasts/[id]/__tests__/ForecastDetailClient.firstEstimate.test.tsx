/**
 * daatan#2347 — a just-published forecast's first Oracul estimate lands ~40 s after
 * publish, in the background. The page opened at publish time must say it is coming and
 * pick it up by itself, not sit on "No sources yet" until a manual reload.
 */
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { NextIntlClientProvider } from 'next-intl'
import ForecastDetailClient from '../ForecastDetailClient'
import {
  FIRST_ESTIMATE_POLL_MS,
  FIRST_ESTIMATE_WAIT_MS,
  firstEstimateDeadline,
} from '../_forecast/useFirstEstimatePoll'
import enMessages from '../../../../../messages/en.json'

const refresh = vi.fn()
vi.mock('next-auth/react', () => ({ useSession: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  useParams: () => ({ id: 'pred-1' }),
}))
vi.mock('@/components/forecasts/Speedometer', () => ({ default: () => null }))
vi.mock('@/components/comments/CommentThread', () => ({ default: () => null }))
vi.mock('@/components/forecasts/ConfidenceSlider', () => ({ default: () => null }))
vi.mock('@/components/forecasts/ContextTimeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/forecasts/ContextTimeline')>()),
  default: () => null,
}))
vi.mock('../ModeratorResolutionSection', () => ({ ModeratorResolutionSection: () => null }))
vi.mock('../_forecast/SimilarForecasts', () => ({ SimilarForecasts: () => null }))

const NOW = Date.parse('2026-11-26T10:13:00.000Z')
const PUBLISHED = '2026-11-26T10:12:55.000Z'

const makePrediction = (overrides: Record<string, unknown> = {}) => ({
  id: 'pred-1',
  claimText: 'Test claim',
  detailsText: '',
  outcomeType: 'BINARY',
  status: 'ACTIVE',
  resolveByDatetime: '2030-01-01T00:00:00.000Z',
  author: { id: 'u1', name: 'User', username: 'user', image: null, rs: 100, role: 'USER' },
  options: [],
  commitments: [],
  totalCuCommitted: 0,
  isPublic: true,
  shareToken: 'token',
  confidence: null,
  publishedAt: PUBLISHED,
  settled: false,
  ...overrides,
})

const snapshot = (extra: Record<string, unknown> = {}) => ({
  id: 's1',
  summary: '',
  sources: [],
  createdAt: '2026-11-26T10:13:28.000Z',
  externalProbability: 59,
  oracleSnapshot: { mean: 59, ciLow: 50, ciHigh: 69, settled: false },
  ...extra,
})

const wrap = (ui: React.ReactElement) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>
)

/** Routes the page's fetches: the forecast itself, and the timeline the poll reads. */
const mockFetch = (forecast: Record<string, unknown>, timeline: () => unknown[]) => {
  const fn = vi.fn(async (url: string) => {
    if (url.endsWith('/context')) return { ok: true, json: async () => ({ snapshots: timeline() }) }
    return { ok: true, json: async () => forecast }
  })
  global.fetch = fn as unknown as typeof fetch
  return fn
}
const contextCalls = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.filter(([url]) => String(url).endsWith('/context')).length

const renderPage = async (data: Record<string, unknown>, initialContextSnapshots: unknown[] = []) => {
  await act(async () => {
    render(wrap(
      <ForecastDetailClient
        initialData={data as never}
        initialContextSnapshots={initialContextSnapshots as never}
      />,
    ))
  })
}

const advance = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

const globalFetch = global.fetch

describe('ForecastDetailClient — waiting for the first Oracul estimate (daatan#2347)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: false })
    vi.setSystemTime(NOW)
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as never)
  })
  afterEach(() => {
    vi.useRealTimers()
    global.fetch = globalFetch
  })

  it('a fresh forecast says the estimate is coming, not that there are no sources', async () => {
    const data = makePrediction()
    mockFetch(data, () => [])
    await renderPage(data)
    expect(screen.getByTestId('ai-estimating')).toHaveTextContent(enMessages.forecast.aiEstimating)
    expect(screen.getByTestId('ai-how-estimated')).toHaveTextContent(enMessages.forecast.aiHowEstimating)
    expect(screen.queryByTestId('ai-no-sources-yet')).not.toBeInTheDocument()
  })

  it('picks the estimate up when it lands, without a reload', async () => {
    const data = makePrediction()
    let timeline: unknown[] = []
    const fetchMock = mockFetch(data, () => timeline)
    await renderPage(data)

    await advance(FIRST_ESTIMATE_POLL_MS)
    expect(contextCalls(fetchMock)).toBe(1)
    expect(screen.getByTestId('ai-estimating')).toBeInTheDocument()

    timeline = [snapshot()]
    await advance(FIRST_ESTIMATE_POLL_MS)
    expect(screen.queryByTestId('ai-estimating')).not.toBeInTheDocument()
    expect(screen.getByText(`${enMessages.forecast.legendAI} 59%`)).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)

    await advance(FIRST_ESTIMATE_POLL_MS * 3)
    expect(contextCalls(fetchMock)).toBe(2)
  })

  it('an abstaining first run shows "Insufficient evidence"', async () => {
    const data = makePrediction()
    mockFetch(data, () => [snapshot({ externalProbability: null, insufficientData: true })])
    await renderPage(data)
    await advance(FIRST_ESTIMATE_POLL_MS)
    expect(screen.getByText(`${enMessages.forecast.legendAI} · ${enMessages.forecast.aiInsufficientEvidence}`)).toBeInTheDocument()
    expect(screen.queryByTestId('ai-estimating')).not.toBeInTheDocument()
  })

  it('stops polling once the window closes', async () => {
    const data = makePrediction()
    const fetchMock = mockFetch(data, () => [])
    await renderPage(data)
    await advance(FIRST_ESTIMATE_WAIT_MS + 2 * 60_000)
    const calls = contextCalls(fetchMock)
    expect(calls).toBeLessThanOrEqual(FIRST_ESTIMATE_WAIT_MS / FIRST_ESTIMATE_POLL_MS)
    await advance(10 * FIRST_ESTIMATE_POLL_MS)
    expect(contextCalls(fetchMock)).toBe(calls)
    expect(screen.getByTestId('ai-no-sources-yet')).toBeInTheDocument()
  })

  it('an older forecast with no estimate does not poll', async () => {
    const data = makePrediction({ publishedAt: '2026-11-26T09:00:00.000Z' })
    const fetchMock = mockFetch(data, () => [])
    await renderPage(data)
    await advance(FIRST_ESTIMATE_POLL_MS * 3)
    expect(contextCalls(fetchMock)).toBe(0)
    expect(screen.getByTestId('ai-no-sources-yet')).toBeInTheDocument()
  })
})

describe('firstEstimateDeadline', () => {
  const p = makePrediction() as Parameters<typeof firstEstimateDeadline>[0]
  const deadline = Date.parse(PUBLISHED) + FIRST_ESTIMATE_WAIT_MS

  it('waits for a fresh public ACTIVE BINARY forecast with no estimate', () => {
    expect(firstEstimateDeadline(p, false, NOW)).toBe(deadline)
  })

  it.each([
    ['already estimated', { ...p, confidence: 40 }, false],
    ['has a snapshot', p, true],
    ['multiple choice', { ...p, outcomeType: 'MULTIPLE_CHOICE' }, false],
    ['private', { ...p, isPublic: false }, false],
    ['not active', { ...p, status: 'PENDING_APPROVAL' }, false],
    ['never published', { ...p, publishedAt: undefined }, false],
  ])('nothing to wait for: %s', (_label, input, hasEstimate) => {
    expect(firstEstimateDeadline(input, hasEstimate, NOW)).toBeNull()
  })

  it('stops at the end of the window', () => {
    expect(firstEstimateDeadline(p, false, deadline)).toBeNull()
  })
})
