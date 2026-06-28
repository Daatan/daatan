import { describe, it, expect, vi, beforeEach } from 'vitest'

const tx = {
  prediction: { update: vi.fn().mockResolvedValue({ id: 'p1' }) },
  predictionTranslation: { deleteMany: vi.fn(), createMany: vi.fn() },
  predictionOption: { deleteMany: vi.fn(), createMany: vi.fn() },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findUnique: vi.fn() },
    predictionTranslation: { deleteMany: vi.fn() },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  },
}))
vi.mock('@/lib/services/embedding', () => ({ embedText: vi.fn(), embedAndStoreForecast: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/services/indexnow', () => ({ notifyIndexNow: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))
vi.mock('@/lib/services/translation', () => ({
  normalizeForecastToEnglish: vi.fn(),
  translatePredictionToAllLocales: vi.fn().mockResolvedValue(undefined),
  sourceHash: (s: string) => `h${s.length}`,
  TRANSLATABLE_FIELDS: ['claimText', 'detailsText', 'resolutionRules'],
}))

import { prisma } from '@/lib/prisma'
import { embedAndStoreForecast } from '@/lib/services/embedding'
import { normalizeForecastToEnglish } from '@/lib/services/translation'
import { updateForecast, ForecastTranslationUnavailableError } from '../forecast'

const HEBREW = 'לפחות מפלגה אחת תפרוש מהמרוץ'
const ENGLISH = 'At least one party will withdraw from the race'

const mockFindUnique = vi.mocked(prisma.prediction.findUnique)
const mockNormalize = vi.mocked(normalizeForecastToEnglish)

beforeEach(() => vi.clearAllMocks())

describe('updateForecast — original-language edit', () => {
  it('re-derives English, keeps the slug, and seeds the original-language translation', async () => {
    mockFindUnique.mockResolvedValue({ originalLanguage: 'he' } as never)
    mockNormalize.mockResolvedValue({
      language: 'he',
      isEnglish: false,
      english: { claimText: ENGLISH, detailsText: null, resolutionRules: null },
      original: { claimText: HEBREW, detailsText: null, resolutionRules: null },
    } as never)

    await updateForecast('p1', { claimText: HEBREW })

    // normalize ran on the submitted Hebrew
    expect(mockNormalize).toHaveBeenCalledWith({ claimText: HEBREW, detailsText: null, resolutionRules: null })
    // prediction updated to the English canonical, WITHOUT touching slug/originalLanguage
    const data = tx.prediction.update.mock.calls[0][0].data
    expect(data.claimText).toBe(ENGLISH)
    expect(data).not.toHaveProperty('slug')
    expect(data).not.toHaveProperty('originalLanguage')
    // original-language translation re-seeded with the author's exact Hebrew
    expect(tx.predictionTranslation.deleteMany).toHaveBeenCalled()
    const seeded = tx.predictionTranslation.createMany.mock.calls[0][0].data
    expect(seeded).toContainEqual(expect.objectContaining({ fieldName: 'claimText', language: 'he', translatedText: HEBREW }))
    // English re-embedded
    expect(embedAndStoreForecast).toHaveBeenCalledWith('p1', ENGLISH)
  })

  it('throws ForecastTranslationUnavailableError when translation is down (never stores untranslated as canonical)', async () => {
    mockFindUnique.mockResolvedValue({ originalLanguage: 'he' } as never)
    mockNormalize.mockResolvedValue({
      language: null, isEnglish: true,
      english: { claimText: HEBREW, detailsText: null, resolutionRules: null },
      original: { claimText: HEBREW, detailsText: null, resolutionRules: null },
    } as never)

    await expect(updateForecast('p1', { claimText: HEBREW })).rejects.toBeInstanceOf(ForecastTranslationUnavailableError)
    expect(tx.prediction.update).not.toHaveBeenCalled()
  })

  it('does a direct update (no translate) for an English-authored forecast', async () => {
    mockFindUnique.mockResolvedValue({ originalLanguage: null } as never)
    await updateForecast('p1', { claimText: ENGLISH })
    expect(mockNormalize).not.toHaveBeenCalled()
    expect(tx.prediction.update.mock.calls[0][0].data.claimText).toBe(ENGLISH)
  })

  it('falls back to a direct update when an original-language forecast is rewritten in English', async () => {
    mockFindUnique.mockResolvedValue({ originalLanguage: 'he' } as never)
    mockNormalize.mockResolvedValue({
      language: 'en', isEnglish: true,
      english: { claimText: ENGLISH, detailsText: null, resolutionRules: null },
      original: { claimText: ENGLISH, detailsText: null, resolutionRules: null },
    } as never)
    await updateForecast('p1', { claimText: ENGLISH })
    // normalize is consulted, but no original-language seeding happens
    expect(mockNormalize).toHaveBeenCalled()
    expect(tx.predictionTranslation.createMany).not.toHaveBeenCalled()
    expect(tx.prediction.update.mock.calls[0][0].data.claimText).toBe(ENGLISH)
  })
})
