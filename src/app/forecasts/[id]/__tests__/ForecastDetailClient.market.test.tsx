/**
 * daatan#2323 — the linked market's price sits beside Community/You/AI on the page,
 * polarity-adjusted, and the chart's "not the same question" hint is translated.
 */
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { NextIntlClientProvider } from 'next-intl'
import ForecastDetailClient from '../ForecastDetailClient'
import ruMessages from '../../../../../messages/ru.json'
import enMessages from '../../../../../messages/en.json'

const chartProps = vi.fn()

vi.mock('next-auth/react', () => ({ useSession: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useParams: () => ({ id: 'pred-1' }),
}))
vi.mock('next/dynamic', () => ({
  default: () => (props: Record<string, unknown>) => {
    chartProps(props)
    return null
  },
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

const recent = new Date(Date.now() - 3_600_000).toISOString()

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
  externalMarket: {
    provider: 'POLYMARKET',
    slug: 'x',
    url: 'https://polymarket.com/event/x',
    question: 'Will X happen?',
    outcomes: ['Yes', 'No'],
    resolved: false,
    endDate: null,
    snapshots: [
      { createdAt: '2026-11-01T00:00:00.000Z', probability: 20 },
      { createdAt: recent, probability: 30 },
    ],
  },
  externalMarketInverted: false,
  ...overrides,
})

const globalFetch = global.fetch
afterEach(() => { global.fetch = globalFetch })

const renderPage = async (prediction: Record<string, unknown> = {}, messages = enMessages, locale = 'en') => {
  const data = makePrediction(prediction)
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => data })
  await act(async () => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ForecastDetailClient initialData={data as never} initialContextSnapshots={[]} />
      </NextIntlClientProvider>,
    )
  })
}

describe('ForecastDetailClient — linked market number (daatan#2323)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSession).mockReturnValue({ data: { user: { id: 'u1' } }, status: 'authenticated' } as never)
  })

  it('shows the newest market price beside the other estimates', async () => {
    await renderPage()
    expect(screen.getByTestId('legend-market')).toHaveTextContent('Polymarket 30%')
  })

  it('shows 100 − price for an inverted link', async () => {
    await renderPage({ externalMarketInverted: true })
    expect(screen.getByTestId('legend-market')).toHaveTextContent('Polymarket 70%')
  })

  it('shows no market entry without a linked market', async () => {
    await renderPage({ externalMarket: null })
    expect(screen.queryByTestId('legend-market')).toBeNull()
  })

  it('says nobody has forecast yet instead of 50%', async () => {
    await renderPage()
    expect(screen.getByTestId('legend-community')).toHaveTextContent(enMessages.forecast.legendNoForecastsYet)
    expect(screen.queryByTitle(enMessages.forecast.communityProbabilityTooltip)).toBeNull()
  })

  it('hands the chart a translated "related, not the same question" hint and inverted label', async () => {
    await renderPage({ externalMarketInverted: true }, ruMessages, 'ru')
    const props = chartProps.mock.calls.at(-1)?.[0] as { marketHint: string; marketLabel: string }
    expect(props.marketHint).toBe(`Вопрос рынка: «\u2068Will X happen?\u2069». ${ruMessages.forecast.marketNotIdentical}`)
    expect(props.marketLabel).toBe(`Polymarket, ${ruMessages.forecast.marketInvertedWord}`)
  })
})
