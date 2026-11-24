/**
 * daatan#2301 — who really created a forecast published as Daatan is shown to admins only.
 * The page passes `realCreator` only when the viewer is an admin; this checks the client
 * renders exactly what it is handed and nothing when it is not.
 */
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

const wrap = (ui: React.ReactElement) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>
)

const globalFetch = global.fetch
afterEach(() => { global.fetch = globalFetch })

const daatanForecast = makePrediction({
  author: { id: 'daatan-user', name: 'Daatan', username: 'daatan', image: '/logo-icon-192.png', rs: 100, role: 'USER' },
})

const renderWith = async (props: Record<string, unknown> = {}) => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => daatanForecast })
  await act(async () => {
    render(wrap(<ForecastDetailClient initialData={daatanForecast as never} {...props} />))
  })
}

describe('ForecastDetailClient — real creator of a Daatan forecast (daatan#2301)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSession).mockReturnValue({ data: { user: { id: 'admin1', role: 'ADMIN' } }, status: 'authenticated' } as never)
  })

  it('names the admin who created it, marked admin-only', async () => {
    await renderWith({ realCreator: { id: 'admin1', name: 'Mark', username: 'mark' } })
    const line = screen.getByTestId('real-creator')
    expect(line).toHaveTextContent('Created by Mark')
    expect(line).toHaveTextContent('visible to admins only')
  })

  it('shows Daatan as the author and no creator line when none is passed', async () => {
    await renderWith()
    expect(screen.queryByTestId('real-creator')).toBeNull()
    expect(screen.getAllByText('Daatan').length).toBeGreaterThan(0)
  })
})
