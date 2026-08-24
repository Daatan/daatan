import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    evidencePoolArticle: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    prediction: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/services/oracle-backfill', () => ({
  refreshOracleSnapshot: (...a: unknown[]) => mockRefresh(...a),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { prisma } from '@/lib/prisma'
import {
  remediatePool,
  remediableWhere,
  usablePoolWhere,
  REMEDIATE_MIN_ABS_STANCE,
  REMEDIATE_MIN_CERTAINTY,
} from '../pool-remediate'

const mockRows = vi.mocked(prisma.evidencePoolArticle.findMany)
const mockCount = vi.mocked(prisma.evidencePoolArticle.count)
const mockUpdateMany = vi.mocked(prisma.evidencePoolArticle.updateMany)
const mockPredictions = vi.mocked(prisma.prediction.findMany)
const mockPrediction = vi.mocked(prisma.prediction.findUnique)

const PRED = {
  id: 'p1',
  claimText: 'Will X happen?',
  claimDirection: null,
  claimDeadline: null,
  createdAt: null,
  claimArchetype: null,
  resolutionRules: null,
  confidence: 66,
}

function row(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `r${i}`,
    url: `https://a.com/${i}`,
    title: `Headline ${i}`,
    snippet: `Body ${i}`,
    source: 'a.com',
    publishedDate: '2026-08-01',
    ...over,
  }
}

describe('remediatePool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefresh.mockResolvedValue({ status: 'ok', sources: 3 })
    mockPredictions.mockResolvedValue([PRED] as never)
    mockPrediction.mockResolvedValue({ confidence: 34 } as never)
    mockRows.mockResolvedValue([row(1)] as never)
    mockCount.mockResolvedValue(20)
    mockUpdateMany.mockResolvedValue({ count: 1 } as never)
  })

  it('nulls contentHash on the batch BEFORE re-extracting it', async () => {
    // The whole run's reversibility rests on this order. With the stored hash still in
    // place claimArticleForExtraction takes its same-content arm and re-claims the row
    // in place — overwriting the very reading being remediated, with no superseded
    // version left to restore. Null first and it supersedes-and-inserts instead.
    mockRows.mockResolvedValue([row(1), row(2)] as never)

    await remediatePool(['p1'], true)

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1', 'r2'] } },
      data: { contentHash: null },
    })
    expect(mockUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(mockRefresh.mock.invocationCallOrder[0])
  })

  it('writes nothing in dry-run, and dry-run is the default', async () => {
    const r = await remediatePool(['p1'], false)

    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(r.mode).toBe('dry-run')
    expect(r.forecasts[0].targetRows).toBe(1)
    // Still reports what an apply WOULD touch, so the plan can be checked before writing.
    expect(r.forecasts[0].poolBefore).toBe(20)
    expect(r.forecasts[0].confidenceBefore).toBe(66)
    expect(r.forecasts[0].confidenceAfter).toBeNull()
  })

  it('batches at the Oracle article cap, nulling each batch separately', async () => {
    // Per batch, not all up front: an aborted run then leaves the rows it never reached
    // with their hashes intact, so the next organic push still de-duplicates on them.
    mockRows.mockResolvedValue(Array.from({ length: 16 }, (_, i) => row(i + 1)) as never)

    const r = await remediatePool(['p1'], true)

    expect(r.forecasts[0].batches).toBe(2)
    expect(mockRefresh).toHaveBeenCalledTimes(2)
    expect(mockUpdateMany).toHaveBeenCalledTimes(2)
    expect((mockUpdateMany.mock.calls[0][0] as { where: { id: { in: string[] } } }).where.id.in).toHaveLength(15)
    expect((mockUpdateMany.mock.calls[1][0] as { where: { id: { in: string[] } } }).where.id.in).toEqual(['r16'])
    expect(r.forecasts[0].ok).toBe(2)
  })

  it('re-drives rows under origin remediate, re-sending their stored snippet', async () => {
    await remediatePool(['p1'], true)

    expect(mockRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      {
        articles: [
          { url: 'https://a.com/1', title: 'Headline 1', snippet: 'Body 1', source: 'a.com', publishedDate: '2026-08-01' },
        ],
        origin: 'remediate',
        reask: true,
      },
    )
  })

  it('counts an `unchanged` batch — the claim gate refusing is a mechanism failure, not a null extraction', async () => {
    mockRefresh.mockResolvedValue({ status: 'unchanged' })

    const r = await remediatePool(['p1'], true)

    expect(r.forecasts[0].unchanged).toBe(1)
    expect(r.forecasts[0].ok).toBe(0)
  })

  it('survives a batch that throws and keeps going', async () => {
    mockRows.mockResolvedValue([row(1), ...Array.from({ length: 15 }, (_, i) => row(i + 2))] as never)
    mockRefresh.mockRejectedValueOnce(new Error('oracle down')).mockResolvedValue({ status: 'ok', sources: 1 })

    const r = await remediatePool(['p1'], true)

    expect(r.forecasts[0].failed).toBe(1)
    expect(r.forecasts[0].ok).toBe(1)
  })

  it('reports the published estimate either side of the run, and the usable pool either side', async () => {
    mockCount.mockResolvedValueOnce(20).mockResolvedValueOnce(17)

    const r = await remediatePool(['p1'], true)

    expect(r.forecasts[0]).toMatchObject({ confidenceBefore: 66, confidenceAfter: 34, poolBefore: 20, poolAfter: 17 })
  })

  it('makes no Oracle call for a forecast with no target rows', async () => {
    mockRows.mockResolvedValue([] as never)

    const r = await remediatePool(['p1'], true)

    expect(mockRefresh).not.toHaveBeenCalled()
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(r.forecasts[0]).toMatchObject({ targetRows: 0, batches: 0 })
  })

  describe('remediableWhere', () => {
    const where = remediableWhere()

    it('targets only current-version usable rows', () => {
      // Inherited from USABLE_POOL_ROW_WHERE so the two can never drift: remediating a
      // superseded row would resurrect a reading a later version already replaced.
      expect(where).toMatchObject({
        supersededAt: null,
        excluded: false,
        status: 'COMPLETE',
        credibilityWeight: { not: null },
        relevanceScore: { not: null },
      })
    })

    it('targets strong stance at high certainty, in both directions', () => {
      expect(where.OR).toEqual([
        { stance: { gte: REMEDIATE_MIN_ABS_STANCE } },
        { stance: { lte: -REMEDIATE_MIN_ABS_STANCE } },
      ])
      expect(where.certainty).toEqual({ gte: REMEDIATE_MIN_CERTAINTY })
    })

    it('skips search-redirect URLs, which have no article behind them to re-read', () => {
      expect(where.NOT).toEqual({ url: { contains: 'google.com/goto' } })
    })
  })

  describe('usablePoolWhere', () => {
    const where = usablePoolWhere()

    it('targets the full usable pool, unfiltered by stance or certainty', () => {
      expect(where).toMatchObject({
        supersededAt: null,
        excluded: false,
        status: 'COMPLETE',
        stance: { not: null },
        certainty: { not: null },
        credibilityWeight: { not: null },
        relevanceScore: { not: null },
      })
      expect(where.OR).toBeUndefined()
    })

    it('still skips search-redirect URLs', () => {
      expect(where.NOT).toEqual({ url: { contains: 'google.com/goto' } })
    })
  })

  it('defaults the target to remediableWhere when none is passed', async () => {
    await remediatePool(['p1'], true)

    expect(mockRows).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ predictionId: 'p1', ...remediableWhere() }) }),
    )
  })

  it('uses a passed-in target instead of remediableWhere', async () => {
    await remediatePool(['p1'], true, usablePoolWhere())

    const where = (mockRows.mock.calls[0]?.[0] as { where: Record<string, unknown> }).where
    expect(where).not.toHaveProperty('OR')
    expect(where).toMatchObject({ predictionId: 'p1', status: 'COMPLETE' })
  })
})
