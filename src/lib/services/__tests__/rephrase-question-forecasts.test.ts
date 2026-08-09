import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { prediction: { findUnique: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/services/embedding', () => ({ embedAndStoreForecast: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/services/translation', () => ({
  translatePredictionToAllLocales: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { prisma } from '@/lib/prisma'
import { embedAndStoreForecast } from '@/lib/services/embedding'
import { translatePredictionToAllLocales } from '@/lib/services/translation'
import { rephraseOne, REPHRASINGS, rephraseQuestionForecasts } from '../rephrase-question-forecasts'

const mockFindUnique = vi.mocked(prisma.prediction.findUnique)
const mockUpdate = vi.mocked(prisma.prediction.update)

const ENTRY = REPHRASINGS[0]

beforeEach(() => vi.clearAllMocks())

describe('REPHRASINGS table', () => {
  it('rewrites every claim out of question form', () => {
    for (const r of REPHRASINGS) {
      expect(r.to.endsWith('?'), `${r.id} still ends with a question mark`).toBe(false)
      expect(/^(will|is|are|do|does|did|can|could|should|would|has|have)\b/i.test(r.to)).toBe(false)
    }
  })

  it('actually changes each claim, and has no duplicate ids', () => {
    for (const r of REPHRASINGS) expect(r.to).not.toBe(r.from)
    expect(new Set(REPHRASINGS.map((r) => r.id)).size).toBe(REPHRASINGS.length)
  })
})

describe('rephraseOne', () => {
  it('rewrites, re-embeds and re-translates when the claim matches the reviewed text', async () => {
    mockFindUnique.mockResolvedValue({ claimText: ENTRY.from } as never)

    expect(await rephraseOne(ENTRY, false)).toBe('rephrased')
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: ENTRY.id }, data: { claimText: ENTRY.to } })
    expect(embedAndStoreForecast).toHaveBeenCalledWith(ENTRY.id, ENTRY.to)
    expect(translatePredictionToAllLocales).toHaveBeenCalledWith(ENTRY.id)
  })

  it('never touches the slug', async () => {
    mockFindUnique.mockResolvedValue({ claimText: ENTRY.from } as never)
    await rephraseOne(ENTRY, false)
    expect(mockUpdate.mock.calls[0]?.[0].data).not.toHaveProperty('slug')
  })

  it('is a no-op on re-run (already rephrased)', async () => {
    mockFindUnique.mockResolvedValue({ claimText: ENTRY.to } as never)

    expect(await rephraseOne(ENTRY, false)).toBe('already')
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(embedAndStoreForecast).not.toHaveBeenCalled()
  })

  it('refuses to overwrite a claim that drifted since review', async () => {
    mockFindUnique.mockResolvedValue({ claimText: 'Someone edited this by hand' } as never)

    expect(await rephraseOne(ENTRY, false)).toBe('mismatch')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('reports a deleted forecast as missing', async () => {
    mockFindUnique.mockResolvedValue(null as never)

    expect(await rephraseOne(ENTRY, false)).toBe('missing')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('writes nothing in dry-run mode', async () => {
    mockFindUnique.mockResolvedValue({ claimText: ENTRY.from } as never)

    expect(await rephraseOne(ENTRY, true)).toBe('rephrased')
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(embedAndStoreForecast).not.toHaveBeenCalled()
    expect(translatePredictionToAllLocales).not.toHaveBeenCalled()
  })

  it('still reports success when the embedding refresh fails', async () => {
    mockFindUnique.mockResolvedValue({ claimText: ENTRY.from } as never)
    vi.mocked(embedAndStoreForecast).mockRejectedValueOnce(new Error('bedrock down'))

    expect(await rephraseOne(ENTRY, false)).toBe('rephrased')
    expect(translatePredictionToAllLocales).toHaveBeenCalledWith(ENTRY.id)
  })
})

describe('rephraseQuestionForecasts', () => {
  it('counts every entry in the table', async () => {
    mockFindUnique.mockImplementation((async ({ where }: { where: { id: string } }) => {
      const entry = REPHRASINGS.find((r) => r.id === where.id)
      return entry ? { claimText: entry.from } : null
    }) as never)

    const report = await rephraseQuestionForecasts(true)
    expect(report.dryRun).toBe(true)
    expect(report.counts.rephrased).toBe(REPHRASINGS.length)
    expect(report.rows).toHaveLength(REPHRASINGS.length)
  })
})
