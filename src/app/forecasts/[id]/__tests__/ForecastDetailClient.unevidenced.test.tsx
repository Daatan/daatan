/**
 * daatan#1475 — a published confidence with nothing behind it says so.
 *
 * Measured on prod 2026-08-18: 9 ACTIVE forecasts display a confidence while holding ZERO
 * pool rows the aggregate can read, 2 of them in the extreme band (≥90 or ≤10). 46% of all
 * `evidence_pool_articles` rows are FAILED, so a forecast can look well-evidenced (150 raw
 * rows) and have almost nothing behind its number.
 *
 * The number is surfaced, not suppressed. Suppressing would render identically to an
 * abstention, which is a different state — the write layer distinguishes "abstained" from
 * "never had evidence" since daatan#1473, and collapsing them at the last mile would undo
 * that. It also changes a public number on 9 live forecasts with no human review, where
 * annotating changes only what we claim about it.
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
  confidence: 94,
  settled: false,
  ...overrides,
})

const snapshots = (extra: Partial<Snapshot> = {}): Snapshot[] => [
  {
    id: 's1',
    summary: 'Latest context',
    sources: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    externalProbability: 94,
    oracleSnapshot: null,
    ...extra,
  } as Snapshot,
]

const wrap = (ui: React.ReactElement) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>
)

const globalFetch = global.fetch
afterEach(() => { global.fetch = globalFetch })

const NOTICE = 'unevidenced-notice'

describe('ForecastDetailClient — unevidenced published number (daatan#1475)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: 'u1' } }, status: 'authenticated',
    } as never)
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => makePrediction() })
  })

  /**
   * The component re-fetches the forecast on mount and prefers that copy, so the
   * mock must serve the same overrides as `initialData` — otherwise a null
   * confidence is quietly restored to the default one render later.
   */
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

  it('annotates the number when the pool holds nothing the aggregate can read', async () => {
    await renderWith({ usableEvidenceCount: 0 })
    expect(screen.getByTestId(NOTICE)).toHaveTextContent(enMessages.forecast.aiUnevidencedNotice)
  })

  it('still shows the number — the estimate is unverifiable, not known to be wrong', async () => {
    // Surfacing, not suppressing: the legend keeps reading out the published estimate.
    const { container } = await renderWith({ usableEvidenceCount: 0 })
    expect(container.textContent).toContain(`${enMessages.forecast.legendAI} 94%`)
  })

  it('says nothing when a single usable row exists', async () => {
    await renderWith({ usableEvidenceCount: 1 })
    expect(screen.queryByTestId(NOTICE)).not.toBeInTheDocument()
  })

  it('says nothing when the count was not computed — silence is the fail-open direction', async () => {
    // A caller that never ran the count must not make every forecast look unevidenced.
    await renderWith({})
    expect(screen.queryByTestId(NOTICE)).not.toBeInTheDocument()
  })

  it('says nothing when there is no published number to qualify', async () => {
    await renderWith({ usableEvidenceCount: 0 }, { confidence: null }, { externalProbability: null })
    expect(screen.queryByTestId(NOTICE)).not.toBeInTheDocument()
  })

  it('abstention wins: the needle is already hidden, so the notice would be noise', async () => {
    // The two states are related but distinct — "the latest run found nothing bearing on
    // the claim" versus "nothing in the pool is readable at all". Only one is shown.
    const { container } = await renderWith(
      { usableEvidenceCount: 0 },
      {},
      { insufficientData: true, externalProbability: null },
    )
    expect(screen.queryByTestId(NOTICE)).not.toBeInTheDocument()
    expect(container.textContent).toContain(enMessages.forecast.aiInsufficientEvidence)
  })
})
