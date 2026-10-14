/**
 * daatan#1806 — the AI estimate says what it rests on, and a forecast that was never
 * estimated says so instead of rendering an empty legend.
 *
 * Measured on prod 2026-10-14: the two number-less ACTIVE forecasts the beta tester hit
 * hold a single `backfill` snapshot with no pool and `insufficient_data = false` — never
 * analysed, not abstained — so the page showed neither a number nor any explanation.
 */
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
  confidence: 74,
  settled: false,
  ...overrides,
})

const snapshots = (extra: Partial<Snapshot> = {}): Snapshot[] => [
  {
    id: 's1',
    summary: 'Latest context',
    sources: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    externalProbability: 74,
    oracleSnapshot: null,
    ...extra,
  } as Snapshot,
]

const wrap = (ui: React.ReactElement) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>
)

const globalFetch = global.fetch
afterEach(() => { global.fetch = globalFetch })

const LINE = 'ai-how-estimated'
const NO_SOURCES = 'ai-no-sources-yet'

describe('ForecastDetailClient — how the AI estimate was made (daatan#1806)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: 'u1' } }, status: 'authenticated',
    } as never)
  })

  const renderWith = async (
    props: Record<string, unknown> = {},
    prediction: Record<string, unknown> = {},
    snapshotExtra: Partial<Snapshot> = {},
  ) => {
    const data = makePrediction(prediction)
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => data })
    let result!: ReturnType<typeof render>
    await act(async () => {
      result = render(wrap(
        <ForecastDetailClient
          initialData={data as never}
          initialContextSnapshots={snapshots(snapshotExtra)}
          {...props}
        />,
      ))
    })
    return result
  }

  it('evidence-backed number: names the source count and links the explainer', async () => {
    await renderWith({ usableEvidenceCount: 3 })
    const line = screen.getByTestId(LINE)
    expect(line).toHaveTextContent('Based on 3 sources')
    expect(line.querySelector('a')).toHaveAttribute('href', '/help/rating-numbers')
  })

  it('singular source reads naturally', async () => {
    await renderWith({ usableEvidenceCount: 1 })
    expect(screen.getByTestId(LINE)).toHaveTextContent('Based on 1 source')
  })

  it('number with an empty pool: says it is a model estimate', async () => {
    await renderWith({ usableEvidenceCount: 0 })
    expect(screen.getByTestId(LINE)).toHaveTextContent(enMessages.forecast.aiHowModelOnly)
  })

  it('unknown source count: no line rather than a guess', async () => {
    await renderWith({})
    expect(screen.queryByTestId(LINE)).not.toBeInTheDocument()
  })

  it('never estimated: labels the legend and explains, without inventing a number', async () => {
    const { container } = await renderWith(
      { usableEvidenceCount: 0 },
      { confidence: null },
      { externalProbability: null },
    )
    expect(screen.getByTestId(NO_SOURCES)).toHaveTextContent(enMessages.forecast.aiNoSourcesYet)
    expect(screen.getByTestId(LINE)).toHaveTextContent(enMessages.forecast.aiHowNoSources)
    expect(container.textContent).not.toMatch(new RegExp(`${enMessages.forecast.legendAI} \\d+%`))
  })

  it('abstention keeps its own label and gets neither new element', async () => {
    const { container } = await renderWith(
      { usableEvidenceCount: 0 },
      {},
      { insufficientData: true, externalProbability: null },
    )
    expect(screen.queryByTestId(NO_SOURCES)).not.toBeInTheDocument()
    expect(screen.queryByTestId(LINE)).not.toBeInTheDocument()
    expect(container.textContent).toContain(enMessages.forecast.aiInsufficientEvidence)
  })
})
