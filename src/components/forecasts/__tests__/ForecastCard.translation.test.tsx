import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSession } from 'next-auth/react'
import { NextIntlClientProvider } from 'next-intl'
import ForecastCard, { Prediction } from '../ForecastCard'
import enMessages from '../../../../messages/en.json'
import heMessages from '../../../../messages/he.json'

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
}))

// Mock fetch
const globalFetch = global.fetch
beforeEach(() => {
  global.fetch = vi.fn()
})

afterEach(() => {
  global.fetch = globalFetch
})

const basePrediction: Prediction = {
  id: 'pred-1',
  claimText: 'Original English Claim',
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
  newsAnchor: null,
  tags: [],
  _count: {
    commitments: 0,
  },
  totalCuCommitted: 0,
  userHasCommitted: false,
}

describe('ForecastCard Translation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(useSession).mockReturnValue({
      data: null,
      status: 'unauthenticated',
    } as any)
  })

  it('shows original text by default in English locale', () => {
    renderWithIntl(<ForecastCard prediction={basePrediction} />, 'en')
    expect(screen.getByText('Original English Claim')).toBeInTheDocument()
    expect(screen.queryByTitle(/Hebrew/i)).toBeNull()
  })

  it('triggers translation and shows Hebrew toggle in Hebrew locale', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ claimText: 'תרגום לעברית' }),
    } as Response)

    renderWithIntl(<ForecastCard prediction={basePrediction} />, 'he')

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

    // Should show translated text by default (as per our implementation: showTranslated = locale !== 'en')
    await waitFor(() => {
      expect(screen.getByText('תרגום לעברית')).toBeInTheDocument()
    })

    // Should show the toggle button (labeled "נוסח מקורי" in Hebrew context)
    const toggleBtn = screen.getByText('נוסח מקורי')
    expect(toggleBtn).toBeInTheDocument()

    // Click toggle to show original
    fireEvent.click(toggleBtn)
    expect(screen.getByText('Original English Claim')).toBeInTheDocument()
    expect(screen.queryByText('תרגום לעברית')).toBeNull()

    // Click again to show translated
    fireEvent.click(screen.getByText('חזרה לתרגום'))
    expect(screen.getByText('תרגום לעברית')).toBeInTheDocument()
  })

  it('handles translation failure gracefully', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Translation failed'))

    renderWithIntl(<ForecastCard prediction={basePrediction} />, 'he')

    // Should show original text if translation fails
    await waitFor(() => {
      expect(screen.getByText('Original English Claim')).toBeInTheDocument()
    })
  })
})
