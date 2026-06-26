import { describe, it, expect, vi, beforeEach } from 'vitest'

const tx = {
  prediction: { update: vi.fn() },
  predictionSlugAlias: { upsert: vi.fn() },
  predictionTranslation: { upsert: vi.fn() },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
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
import { normalizeForecastToEnglish, translatePredictionToAllLocales } from '@/lib/services/translation'
import { canonicalizeForecastToEnglish } from '../forecast'

const HEBREW = 'לפחות שתי מפלגות ערביות יתמודדו בבחירות 2026.'
const ENGLISH = 'At least two Arab parties will run in the 2026 elections.'

const mockFindUnique = vi.mocked(prisma.prediction.findUnique)
const mockFindMany = vi.mocked(prisma.prediction.findMany)
const mockNormalize = vi.mocked(normalizeForecastToEnglish)

beforeEach(() => {
  vi.clearAllMocks()
  mockFindMany.mockResolvedValue([] as never) // no slug collisions
})

describe('canonicalizeForecastToEnglish', () => {
  it('skips a forecast already processed (original_language set)', async () => {
    mockFindUnique.mockResolvedValue({ id: 'p1', originalLanguage: 'he' } as never)
    expect(await canonicalizeForecastToEnglish('p1')).toBe('skipped')
    expect(mockNormalize).not.toHaveBeenCalled()
  })

  it('skips a missing forecast', async () => {
    mockFindUnique.mockResolvedValue(null as never)
    expect(await canonicalizeForecastToEnglish('nope')).toBe('skipped')
  })

  it('returns "failed" and writes nothing when detection fails', async () => {
    mockFindUnique.mockResolvedValue({ id: 'p1', slug: '2026-1', claimText: HEBREW, detailsText: null, resolutionRules: null, originalLanguage: null } as never)
    mockNormalize.mockResolvedValue({ language: null, isEnglish: true, english: { claimText: HEBREW }, original: { claimText: HEBREW } } as never)
    expect(await canonicalizeForecastToEnglish('p1')).toBe('failed')
    expect(prisma.prediction.update).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('marks a detected-English forecast without re-slugging', async () => {
    mockFindUnique.mockResolvedValue({ id: 'p1', slug: 'tokyo-pledge', claimText: 'Tokyo 都 pledge', detailsText: null, resolutionRules: null, originalLanguage: null } as never)
    mockNormalize.mockResolvedValue({ language: 'en', isEnglish: true, english: { claimText: 'Tokyo 都 pledge' }, original: { claimText: 'Tokyo 都 pledge' } } as never)
    expect(await canonicalizeForecastToEnglish('p1')).toBe('english')
    expect(prisma.prediction.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { originalLanguage: 'en' } })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('canonicalizes a Hebrew forecast: alias old slug, re-slug, seed original, fill locales', async () => {
    mockFindUnique.mockResolvedValue({ id: 'p1', slug: '2026-1', claimText: HEBREW, detailsText: null, resolutionRules: null, originalLanguage: null } as never)
    mockNormalize.mockResolvedValue({
      language: 'he',
      isEnglish: false,
      english: { claimText: ENGLISH, detailsText: null, resolutionRules: null },
      original: { claimText: HEBREW, detailsText: null, resolutionRules: null },
    } as never)

    expect(await canonicalizeForecastToEnglish('p1')).toBe('canonicalized')

    // old slug kept as an alias
    expect(tx.predictionSlugAlias.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: '2026-1' }, create: { slug: '2026-1', predictionId: 'p1' } }),
    )
    // English becomes canonical + new English slug + recorded language
    const upd = tx.prediction.update.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(upd.data.claimText).toBe(ENGLISH)
    expect(upd.data.originalLanguage).toBe('he')
    expect(upd.data.slug).toMatch(/^at-least-two/)
    expect(upd.data.slug).not.toBe('2026-1')
    // author's original wording seeded as the he translation
    expect(tx.predictionTranslation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ language: 'he', translatedText: HEBREW, fieldName: 'claimText' }) }),
    )
    // English claim re-embedded, other locales filled
    expect(embedAndStoreForecast).toHaveBeenCalledWith('p1', ENGLISH)
    expect(translatePredictionToAllLocales).toHaveBeenCalledWith('p1')
  })
})
