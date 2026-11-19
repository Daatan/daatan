import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: string[] = []
const tx = {
  prediction: {
    update: vi.fn(async (_args: { data: Record<string, unknown> }) => { calls.push('update'); return { id: 'p1' } }),
    updateMany: vi.fn(async (_args: unknown) => { calls.push('updateMany'); return { count: 1 } }),
  },
  predictionTranslation: { deleteMany: vi.fn(), createMany: vi.fn() },
  predictionOption: { deleteMany: vi.fn(), createMany: vi.fn() },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findUnique: vi.fn() },
    retroSimulation: { findUnique: vi.fn() },
    predictionTranslation: { deleteMany: vi.fn() },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  },
}))
vi.mock('@/lib/services/embedding', () => ({ embedText: vi.fn(), embedAndStoreForecast: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/llm/headline', () => ({ generateAndStoreHeadline: vi.fn().mockResolvedValue(undefined) }))
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
import { normalizeForecastToEnglish } from '@/lib/services/translation'
import { updateForecast } from '../forecast'

const FUTURE = '2099-12-31T23:59:59.000Z'
const PAST = '2020-01-01T12:00:00.000Z'

const mockFindUnique = vi.mocked(prisma.prediction.findUnique)
const mockRetro = vi.mocked(prisma.retroSimulation.findUnique)

function existing(status: string, originalLanguage = 'en') {
  return { originalLanguage, claimText: 'X will happen', resolveByDatetime: new Date(PAST), status } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  mockRetro.mockResolvedValue(null)
})

describe('updateForecast — extending the deadline of a PENDING forecast (daatan#2262)', () => {
  it('reopens it to ACTIVE, guarded on PENDING, before the field write', async () => {
    mockFindUnique.mockResolvedValue(existing('PENDING'))

    await updateForecast('p1', { resolveByDatetime: FUTURE })

    expect(tx.prediction.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'PENDING' },
      data: { status: 'ACTIVE' },
    })
    expect(calls).toEqual(['updateMany', 'update'])
    expect(tx.prediction.update.mock.calls[0][0].data.resolveByDatetime).toEqual(new Date(FUTURE))
  })

  it('leaves it PENDING when the new deadline has already ended', async () => {
    mockFindUnique.mockResolvedValue(existing('PENDING'))

    await updateForecast('p1', { resolveByDatetime: PAST })

    expect(tx.prediction.updateMany).not.toHaveBeenCalled()
  })

  it('leaves it PENDING when the edit does not touch the deadline', async () => {
    mockFindUnique.mockResolvedValue(existing('PENDING'))

    await updateForecast('p1', { isPublic: true })

    expect(tx.prediction.updateMany).not.toHaveBeenCalled()
    expect(mockRetro).not.toHaveBeenCalled()
  })

  it('never makes a retro simulation live', async () => {
    mockFindUnique.mockResolvedValue(existing('PENDING'))
    mockRetro.mockResolvedValue({ predictionId: 'p1' } as never)

    await updateForecast('p1', { resolveByDatetime: FUTURE })

    expect(tx.prediction.updateMany).not.toHaveBeenCalled()
  })

  it.each(['ACTIVE', 'RESOLVED_CORRECT', 'DRAFT'])('does not touch the status of a %s forecast', async (status) => {
    mockFindUnique.mockResolvedValue(existing(status))

    await updateForecast('p1', { resolveByDatetime: FUTURE })

    expect(tx.prediction.updateMany).not.toHaveBeenCalled()
    expect(mockRetro).not.toHaveBeenCalled()
  })

  it('reopens on the original-language edit path too', async () => {
    mockFindUnique.mockResolvedValue(existing('PENDING', 'he'))
    vi.mocked(normalizeForecastToEnglish).mockResolvedValue({
      language: 'he',
      isEnglish: false,
      english: { claimText: 'X will happen', detailsText: null, resolutionRules: null },
      original: { claimText: 'X יקרה', detailsText: null, resolutionRules: null },
    } as never)

    await updateForecast('p1', { claimText: 'X יקרה', resolveByDatetime: FUTURE })

    expect(tx.prediction.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'PENDING' },
      data: { status: 'ACTIVE' },
    })
    expect(calls).toEqual(['updateMany', 'update'])
  })
})
