import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { NextIntlClientProvider } from 'next-intl'
import ForecastDetailClient from '../ForecastDetailClient'
import enMessages from '../../../../../messages/en.json'
import heMessages from '../../../../../messages/he.json'

// Helper to render with internationalization
const renderWithIntl = (ui: React.ReactElement, locale: 'en' | 'he' = 'en') => {
  const messages = locale === 'en' ? enMessages : heMessages
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      {ui}
    </NextIntlClientProvider>
  )
}

vi.mock('next-auth/react', () => ({
  useSession: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
  }),
  useParams: () => ({ id: 'pred-1' }),
}))

// Mock components to simplify tests
vi.mock('@/components/comments/CommentThread', () => ({ default: () => null }))
vi.mock('@/components/forecasts/CommitmentForm', () => ({ default: () => null }))
vi.mock('@/components/forecasts/CUBalanceIndicator', () => ({ default: () => null }))
vi.mock('@/components/forecasts/Speedometer', () => ({ default: () => null }))
vi.mock('@/components/forecasts/ContextTimeline', () => ({ default: () => null }))
vi.mock('../ModeratorResolutionSection', () => ({ ModeratorResolutionSection: () => null }))
vi.mock('../_forecast/SimilarForecasts', () => ({ SimilarForecasts: () => null }))

// Mock fetch
const globalFetch = global.fetch
beforeEach(() => {
  global.fetch = vi.fn()
})

afterEach(() => {
  global.fetch = globalFetch
})

const basePrediction = {
  id: 'pred-1',
  claimText: 'Original English Claim',
  detailsText: 'Original English Details',
  outcomeType: 'BINARY',
  status: 'ACTIVE',
  resolveByDatetime: new Date().toISOString(),
  author: {
    id: 'user-1',
    name: 'Author',
    username: 'author',
    image: null,
    rs: 100,
    role: 'USER',
  },
  options: [],
  commitments: [],
  totalCuCommitted: 0,
  isPublic: true,
  shareToken: 'token',
}

describe('ForecastDetailClient Translation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(useSession).mockReturnValue({
      data: null,
      status: 'unauthenticated',
    } as any)
    // Default fetch: return base prediction so mount effect settles inside act
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => basePrediction,
    } as Response)
  })

  it('shows original text by default in English locale', async () => {
    await act(async () => {
      renderWithIntl(<ForecastDetailClient initialData={basePrediction as any} />, 'en')
    })
    expect(screen.getByText('Original English Claim')).toBeInTheDocument()
    expect(screen.getByText('Original English Details')).toBeInTheDocument()
    // Button should NOT exist in English
    expect(screen.queryByText(/Translate/i)).toBeNull()
  })

  it('triggers translation and shows Hebrew toggle + disclaimer in Hebrew locale', async () => {
    // Override default: first call returns base prediction, second returns translation
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => basePrediction } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ claimText: 'תרגום כותרת', detailsText: 'תרגום פירוט' }),
      } as Response)

    await act(async () => {
      renderWithIntl(<ForecastDetailClient initialData={basePrediction as any} />, 'he')
    })

    // It should trigger fetch
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/forecasts/pred-1/translate'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ language: 'he' }),
        })
      )
    })

    // Should show translated text and disclaimer by default
    await waitFor(() => {
      expect(screen.getByText('תרגום כותרת')).toBeInTheDocument()
      expect(screen.getByText('תרגום פירוט')).toBeInTheDocument()
      // Disclaimer text from he.json
      expect(screen.getByText(/תורגם על ידי בינה מלאכותית/i)).toBeInTheDocument()
    })

    // Toggle button should be showing "נוסח מקורי" (Show original)
    const toggleBtn = screen.getByText('נוסח מקורי')
    expect(toggleBtn).toBeInTheDocument()

    // Click toggle to show original
    fireEvent.click(toggleBtn)
    expect(screen.getByText('Original English Claim')).toBeInTheDocument()
    expect(screen.getByText('Original English Details')).toBeInTheDocument()
    // Disclaimer should be hidden
    expect(screen.queryByText(/תורגם על ידי בינה מלאכותית/i)).toBeNull()

    // Click again to show translated (label is now "חזרה לתרגום")
    fireEvent.click(screen.getByText('חזרה לתרגום'))
    expect(screen.getByText('תרגום כותרת')).toBeInTheDocument()
  })

  it('handles translation failure gracefully in detailed view', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => basePrediction } as Response)
      .mockRejectedValueOnce(new Error('Translation failed'))

    await act(async () => {
      renderWithIntl(<ForecastDetailClient initialData={basePrediction as any} />, 'he')
    })

    // Should show original text if translation fails
    await waitFor(() => {
      expect(screen.getByText('Original English Claim')).toBeInTheDocument()
    })
  })
})
