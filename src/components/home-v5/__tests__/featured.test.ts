import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { prediction: { findFirst: vi.fn() } } }))
vi.mock('@/lib/services/translation', () => ({ getCachedPredictionTranslation: vi.fn() }))
vi.mock('../examples', async (orig) => ({ ...(await orig<typeof import('../examples')>()), FEATURED_FORECAST_ID: 'pinned-id' }))

import { prisma } from '@/lib/prisma'
import { getCachedPredictionTranslation } from '@/lib/services/translation'
import { getFeaturedForecast } from '../featured'

const ROW = {
  id: 'pinned-id',
  slug: 'no-party-25',
  claimText: 'No party wins more than 25 seats',
  status: 'ACTIVE',
  isPublic: true,
  confidence: 62,
  resolveByDatetime: new Date('2026-11-04T00:00:00Z'),
  author: { id: 'a1' },
  tags: [{ name: 'Politics' }],
}

describe('getFeaturedForecast', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns card data with the cached translation', async () => {
    vi.mocked(prisma.prediction.findFirst).mockResolvedValue(ROW as never)
    vi.mocked(getCachedPredictionTranslation).mockResolvedValue({ claimText: 'ни одна партия' })
    const card = await getFeaturedForecast('ru')
    expect(card).toMatchObject({ statement: 'ни одна партия', confidence: 62, open: true, tags: ['Politics'] })
    expect(card?.href).toBe('/ru/forecasts/no-party-25')
  })

  it('falls back to the canonical text without a translation', async () => {
    vi.mocked(prisma.prediction.findFirst).mockResolvedValue(ROW as never)
    vi.mocked(getCachedPredictionTranslation).mockResolvedValue({})
    const card = await getFeaturedForecast('he')
    expect(card?.statement).toBe(ROW.claimText)
    // An untranslated /he/forecasts page is noindex — link the English one instead.
    expect(card?.href).toBe('/forecasts/no-party-25')
  })

  it.each([
    ['missing', null],
    ['private', { ...ROW, isPublic: false }],
    ['draft', { ...ROW, status: 'DRAFT' }],
    ['no estimate', { ...ROW, confidence: null }],
  ])('hides the card when the forecast is %s', async (_n, row) => {
    vi.mocked(prisma.prediction.findFirst).mockResolvedValue(row as never)
    expect(await getFeaturedForecast('en')).toBeUndefined()
  })

  it('hides the card instead of throwing when the database fails', async () => {
    vi.mocked(prisma.prediction.findFirst).mockRejectedValue(new Error('db down'))
    expect(await getFeaturedForecast('en')).toBeUndefined()
  })
})
