import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import { SimilarForecasts } from '../SimilarForecasts'
import enMessages from '../../../../../../messages/en.json'
import ruMessages from '../../../../../../messages/ru.json'

const item = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'fc-1',
  slug: 'bitcoin-100k',
  claimText: 'Bitcoin will reach $100k',
  status: 'ACTIVE',
  resolveByDatetime: '2027-01-01T00:00:00.000Z',
  author: { name: null, username: null },
  ...over,
})

const jsonResponse = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) })

const wrap = (locale: 'en' | 'ru') =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'ru' ? ruMessages : enMessages}>
      <SimilarForecasts predictionId="pred-1" />
    </NextIntlClientProvider>,
  )

describe('SimilarForecasts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes the active locale to the similar endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ similar: [] }) as unknown as Response)
    wrap('ru')
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/forecasts/similar?id=pred-1&limit=3&language=ru'),
    )
  })

  it('renders server-translated claims and the localized author fallback', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        similar: [item({ claimText: 'Биткоин достигнет $100k', translated: true })],
      }) as unknown as Response,
    )
    wrap('ru')
    expect(await screen.findByText('Биткоин достигнет $100k')).toBeInTheDocument()
    expect(screen.getByText(ruMessages.forecast.anonymous)).toBeInTheDocument()
    // Cache hit — no fill call to /translate
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes('/translate'))).toBe(true)
  })

  it('fills untranslated items via the translate endpoint and swaps in the result', async () => {
    vi.mocked(fetch).mockImplementation((url) =>
      Promise.resolve(
        (String(url).includes('/translate')
          ? jsonResponse({ claimText: 'Биткоин достигнет $100k' })
          : jsonResponse({ similar: [item({ translated: false })] })) as unknown as Response,
      ),
    )
    wrap('ru')
    expect(await screen.findByText('Биткоин достигнет $100k')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith(
      '/api/forecasts/fc-1/translate',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ language: 'ru' }) }),
    )
  })

  it('does not call the translate endpoint on the English locale', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ similar: [item()] }) as unknown as Response,
    )
    wrap('en')
    expect(await screen.findByText('Bitcoin will reach $100k')).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes('/translate'))).toBe(true)
  })
})
