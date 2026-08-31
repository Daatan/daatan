import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { NextIntlClientProvider } from 'next-intl'
import ForecastDetailClient from '../ForecastDetailClient'
import type { Snapshot } from '@/components/forecasts/ContextTimeline'
import enMessages from '../../../../../messages/en.json'

vi.mock('next-auth/react', () => ({ useSession: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: 'pred-1' }),
}))
vi.mock('@/components/forecasts/Speedometer', () => ({ default: () => null }))
vi.mock('@/components/comments/CommentThread', () => ({ default: () => null }))
vi.mock('@/components/forecasts/ConfidenceSlider', () => ({ default: () => null }))
// Keep the real settlingSourceNames export — ForecastDetailClient imports it
// from this module; only the component itself is stubbed out.
vi.mock('@/components/forecasts/ContextTimeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/forecasts/ContextTimeline')>()),
  default: () => null,
}))
vi.mock('../ModeratorResolutionSection', () => ({ ModeratorResolutionSection: () => null }))
vi.mock('../_forecast/SimilarForecasts', () => ({ SimilarForecasts: () => null }))

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
  confidence: 97,
  settled: false,
  ...overrides,
})

// A latest snapshot whose Oracul payload is (or isn't) a settlement pin. The
// second settling source has no sourceName, so its display name must fall back
// to the URL host (sans www).
const makeSnapshots = (settled: boolean, extra: Partial<Snapshot> = {}): Snapshot[] => [
  {
    id: 's1',
    summary: 'Latest context',
    sources: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    externalProbability: 97,
    oracleSnapshot: {
      mean: 97,
      std: 3,
      ciLow: 91,
      ciHigh: 100,
      articlesUsed: 12,
      settled,
      sources: [
        { sourceId: 'a', sourceName: 'RFE/RL', url: 'https://rferl.org/x', stance: 0.9, certainty: 0.9, credibilityWeight: 1, claims: [], settled: true },
        { sourceId: 'b', sourceName: '', url: 'https://www.pravda.com.ua/y', stance: 0.8, certainty: 0.8, credibilityWeight: 1, claims: [], settled: true },
        { sourceId: 'c', sourceName: 'Reuters', url: 'https://reuters.com/z', stance: 0.1, certainty: 0.5, credibilityWeight: 1, claims: [], settled: false },
      ],
    },
    ...extra,
  },
]

const wrap = (ui: React.ReactElement) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>
)

const globalFetch = global.fetch
afterEach(() => { global.fetch = globalFetch })

describe('ForecastDetailClient — Oracul settlement-pin indicator (#1250)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: 'u1' } }, status: 'authenticated',
    } as never)
    const prediction = makePrediction()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => prediction })
  })

  it('renders the pin notice and names the settling sources when the latest snapshot is settled', async () => {
    await act(async () => {
      render(wrap(
        <ForecastDetailClient
          initialData={makePrediction() as never}
          initialContextSnapshots={makeSnapshots(true)}
        />,
      ))
    })

    const notice = screen.getByTestId('settled-pin-notice')
    expect(notice).toHaveTextContent(enMessages.forecast.settledPinNotice)
    // Only the settled: true sources are named; the sans-name one falls back to its host.
    expect(notice).toHaveTextContent('RFE/RL')
    expect(notice).toHaveTextContent('pravda.com.ua')
    expect(notice).not.toHaveTextContent('Reuters')
  })

  it('renders no notice when the latest snapshot is not settled', async () => {
    await act(async () => {
      render(wrap(
        <ForecastDetailClient
          initialData={makePrediction() as never}
          initialContextSnapshots={makeSnapshots(false)}
        />,
      ))
    })
    expect(screen.queryByTestId('settled-pin-notice')).not.toBeInTheDocument()
  })

  it('renders no notice without snapshots at all', async () => {
    await act(async () => {
      render(wrap(<ForecastDetailClient initialData={makePrediction() as never} />))
    })
    expect(screen.queryByTestId('settled-pin-notice')).not.toBeInTheDocument()
  })

  it('abstention wins: no pin notice when the latest run had insufficient data', async () => {
    await act(async () => {
      render(wrap(
        <ForecastDetailClient
          initialData={makePrediction({ confidence: null }) as never}
          initialContextSnapshots={makeSnapshots(true, { insufficientData: true, externalProbability: null })}
        />,
      ))
    })
    expect(screen.queryByTestId('settled-pin-notice')).not.toBeInTheDocument()
  })
})
