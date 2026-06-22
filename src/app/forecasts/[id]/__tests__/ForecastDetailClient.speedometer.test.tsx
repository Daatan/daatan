import { render, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { NextIntlClientProvider } from 'next-intl'
import ForecastDetailClient from '../ForecastDetailClient'
import enMessages from '../../../../../messages/en.json'

// Capture Speedometer calls so we can assert on the percentage prop
const { speedometerMock } = vi.hoisted(() => ({ speedometerMock: vi.fn(() => null) }))
vi.mock('@/components/forecasts/Speedometer', () => ({ default: speedometerMock }))

vi.mock('next-auth/react', () => ({ useSession: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: 'pred-1' }),
}))
vi.mock('@/components/comments/CommentThread', () => ({ default: () => null }))
vi.mock('@/components/forecasts/CommitmentForm', () => ({ default: () => null }))
vi.mock('@/components/forecasts/CUBalanceIndicator', () => ({ default: () => null }))
vi.mock('@/components/forecasts/ContextTimeline', () => ({ default: () => null }))
vi.mock('../ModeratorResolutionSection', () => ({ ModeratorResolutionSection: () => null }))
vi.mock('../_forecast/SimilarForecasts', () => ({ SimilarForecasts: () => null }))

const globalFetch = global.fetch
afterEach(() => { global.fetch = globalFetch })

const makeCommitment = (binaryChoice: boolean, cuCommitted: number, idx = 0) => ({
  id: `c${idx}`,
  binaryChoice,
  cuCommitted,
  optionId: null,
  option: null,
  user: { id: `u${idx}`, username: `user${idx}`, name: `User ${idx}`, image: null, rs: 100 },
})

const makePrediction = (commitments: { binaryChoice: boolean; cuCommitted: number }[]) => {
  const enriched = commitments.map((c, i) => makeCommitment(c.binaryChoice, c.cuCommitted, i))
  return {
    id: 'pred-1',
    claimText: 'Test claim',
    detailsText: '',
    outcomeType: 'BINARY',
    status: 'ACTIVE',
    resolveByDatetime: new Date().toISOString(),
    author: { id: 'u1', name: 'User', username: 'user', image: null, rs: 100, role: 'USER' },
    options: [],
    commitments: enriched,
    totalCuCommitted: enriched.reduce((s, c) => s + c.cuCommitted, 0),
    isPublic: true,
    shareToken: 'token',
  }
}

const wrap = (ui: React.ReactElement) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>
)

const renderPrediction = async (commitments: { binaryChoice: boolean; cuCommitted: number }[]) => {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(wrap(<ForecastDetailClient initialData={makePrediction(commitments) as any} />))
  })
  return result
}

describe('Speedometer — probability calculation', () => {
  // Community probability = the per-person average of each commit's implied
  // P(YES) = (confidence + 100) / 200, where confidence (cuCommitted) is signed:
  // YES is positive, NO is negative. This matches the chart line and the
  // canonical communityProbabilityAtCommit stored per-commit. It deliberately is
  // NOT a CU-weighted YES/NO share (which read 100% off a single YES stake).
  beforeEach(() => {
    speedometerMock.mockClear()
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as any)
    // Provide a default fetch response so the mount effect settles inside act
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePrediction([]),
    })
  })

  it('shows 50% when there are no commitments', async () => {
    await renderPrediction([])
    expect(speedometerMock).toHaveBeenCalledWith(
      expect.objectContaining({ percentage: 50 }),
      expect.anything()
    )
  })

  it('one committer shows their own probability, not 100% — +32 → 66%', async () => {
    // The reported bug: a single YES stake read 100% (CU-share). Now it reflects
    // the committer's stated confidence: (32 + 100) / 200 = 66%.
    await renderPrediction([{ binaryChoice: true, cuCommitted: 32 }])
    const call = (speedometerMock.mock.calls[0] as unknown as [{ percentage: number }])[0]
    expect(call.percentage).not.toBe(100)
    expect(call.percentage).toBe(66)
  })

  it('one full-confidence YES (+100) → 100%', async () => {
    await renderPrediction([{ binaryChoice: true, cuCommitted: 100 }])
    expect(speedometerMock).toHaveBeenCalledWith(
      expect.objectContaining({ percentage: 100 }),
      expect.anything()
    )
  })

  it('one NO committer (−32) → 34%', async () => {
    await renderPrediction([{ binaryChoice: false, cuCommitted: -32 }])
    expect(speedometerMock).toHaveBeenCalledWith(
      expect.objectContaining({ percentage: 34 }),
      expect.anything()
    )
  })

  it('averages opposing views equally — +50 and −50 → 50%', async () => {
    await renderPrediction([
      { binaryChoice: true,  cuCommitted: 50  },
      { binaryChoice: false, cuCommitted: -50 },
    ])
    expect(speedometerMock).toHaveBeenCalledWith(
      expect.objectContaining({ percentage: 50 }),
      expect.anything()
    )
  })

  it('per-person average, not CU-weighted — +100 and −20 → 70%', async () => {
    // (1.00 + 0.40) / 2 = 0.70. A stake-weighted share would skew this; we average
    // the two opinions equally.
    await renderPrediction([
      { binaryChoice: true,  cuCommitted: 100 },
      { binaryChoice: false, cuCommitted: -20 },
    ])
    expect(speedometerMock).toHaveBeenCalledWith(
      expect.objectContaining({ percentage: 70 }),
      expect.anything()
    )
  })
})

describe('Speedometer — state update after voting (router.refresh regression)', () => {
  beforeEach(() => {
    speedometerMock.mockClear()
    vi.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated' } as any)
  })

  it('fetches once on mount but not again when initialData prop changes (simulates router.refresh)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePrediction([]),
    })
    global.fetch = fetchMock

    const initial = makePrediction([])
    let rerender!: ReturnType<typeof render>['rerender']
    await act(async () => {
      const r = render(wrap(<ForecastDetailClient initialData={initial as any} />))
      rerender = r.rerender
    })

    // Simulate router.refresh(): re-render with new initialData reference (same id)
    const refreshedInitial = { ...initial, claimText: 'Server-refreshed claim' }
    await act(async () => {
      rerender(wrap(<ForecastDetailClient initialData={refreshedInitial as any} />))
    })

    // fetch is called once on mount, but NOT again on re-render with same id
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-fetches when navigating to a different forecast id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => makePrediction([]),
    })
    global.fetch = fetchMock

    await act(async () => {
      render(wrap(<ForecastDetailClient />))
    })

    // Should fetch since there's no initialData
    expect(fetchMock).toHaveBeenCalledWith('/api/forecasts/pred-1')
  })
})
