import { render, screen, act } from '@testing-library/react'
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
vi.mock('@/components/forecasts/ContextTimeline', () => ({ default: () => null }))
vi.mock('../ModeratorResolutionSection', () => ({ ModeratorResolutionSection: () => null }))
vi.mock('../_forecast/SimilarForecasts', () => ({ SimilarForecasts: () => null }))

const confidenceSliderProps = vi.fn()
vi.mock('@/components/forecasts/ConfidenceSlider', () => ({
  default: (props: Record<string, unknown>) => {
    confidenceSliderProps(props)
    return null
  },
}))

const FUTURE_DEADLINE = '2030-01-01T00:00:00.000Z'

const makePrediction = (overrides: Record<string, unknown> = {}) => ({
  id: 'pred-1',
  claimText: 'Test claim',
  detailsText: '',
  outcomeType: 'BINARY',
  status: 'ACTIVE',
  resolveByDatetime: FUTURE_DEADLINE,
  author: { id: 'u1', name: 'User', username: 'user', image: null, rs: 100, role: 'USER' },
  options: [],
  commitments: [],
  totalCuCommitted: 0,
  isPublic: true,
  shareToken: 'token',
  settled: false,
  ...overrides,
})

const wrap = (ui: React.ReactElement) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>
)

const globalFetch = global.fetch
afterEach(() => { global.fetch = globalFetch })

describe('ForecastDetailClient — settled notification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: 'u1' } }, status: 'authenticated',
    } as never)
  })

  it('renders no banner when settled — settlement is notification-only (Telegram), not a UI element', async () => {
    const prediction = makePrediction({ settled: true })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => prediction })

    await act(async () => {
      render(wrap(<ForecastDetailClient initialData={prediction as never} />))
    })

    expect(screen.queryByText(/outcome reported/i)).not.toBeInTheDocument()
    expect(confidenceSliderProps).toHaveBeenCalledWith(
      expect.objectContaining({ disabled: false }),
    )
  })

  it('does not show the banner and keeps the slider enabled when not settled', async () => {
    const prediction = makePrediction({ settled: false })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => prediction })

    await act(async () => {
      render(wrap(<ForecastDetailClient initialData={prediction as never} />))
    })

    expect(screen.queryByText(/outcome reported/i)).not.toBeInTheDocument()
    expect(confidenceSliderProps).toHaveBeenCalledWith(
      expect.objectContaining({ disabled: false }),
    )
  })

  it('disables the slider once the resolution deadline has passed, even if not settled', async () => {
    const prediction = makePrediction({ settled: false, resolveByDatetime: '2020-01-01T00:00:00.000Z' })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => prediction })

    await act(async () => {
      render(wrap(<ForecastDetailClient initialData={prediction as never} />))
    })

    // Deadline-passed alone does not read as "settled" — no banner — but commits still lock.
    expect(screen.queryByText(/outcome reported/i)).not.toBeInTheDocument()
    expect(confidenceSliderProps).toHaveBeenCalledWith(
      expect.objectContaining({ disabled: true }),
    )
  })
})
