import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }))

vi.mock('@/lib/prisma', () => {
  const evidencePoolArticle = {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
  }
  return {
    prisma: {
      evidencePoolArticle,
      prediction: { findMany: vi.fn(), findUnique: vi.fn() },
      $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({ evidencePoolArticle })),
    },
  }
})
vi.mock('@/lib/services/oracle-backfill', () => ({
  refreshOracleSnapshot: (...a: unknown[]) => mockRefresh(...a),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { prisma } from '@/lib/prisma'
import { hashArticleContent } from '@/lib/services/evidence-pool'
import {
  remediatePool,
  restoreUnfinishedHeads,
  remediableWhere,
  usablePoolWhere,
  amnestyWhere,
  AMNESTY_CUTOFF,
  REMEDIATE_MIN_ABS_STANCE,
  REMEDIATE_MIN_CERTAINTY,
} from '../pool-remediate'

const mockRows = vi.mocked(prisma.evidencePoolArticle.findMany)
const mockCount = vi.mocked(prisma.evidencePoolArticle.count)
const mockUpdateMany = vi.mocked(prisma.evidencePoolArticle.updateMany)
const mockDeleteMany = vi.mocked(prisma.evidencePoolArticle.deleteMany)
const mockUpdate = vi.mocked(prisma.evidencePoolArticle.update)
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
    mockDeleteMany.mockResolvedValue({ count: 1 } as never)
    mockUpdate.mockResolvedValue({} as never)
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

  it('batches at the Oracul article cap, nulling each batch separately', async () => {
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

  it('makes no Oracul call for a forecast with no target rows', async () => {
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

  describe('amnestyWhere', () => {
    const where = amnestyWhere()

    it('targets pre-cutoff oracle_null_final rows, current-version only', () => {
      // Deliberately NOT spread from USABLE_POOL_ROW_WHERE — these rows are terminal
      // oracle_null_final by definition, so they never had a usable stance/certainty
      // reading (daatan#1547).
      expect(where).toMatchObject({
        supersededAt: null,
        statusReason: 'oracle_null_final',
        updatedAt: { lt: AMNESTY_CUTOFF },
      })
      expect(where).not.toHaveProperty('status')
      expect(where).not.toHaveProperty('excluded')
    })

    it('scopes to ACTIVE predictions with a future resolveByDatetime', () => {
      expect(where.prediction).toEqual({ status: 'ACTIVE', resolveByDatetime: { gt: expect.any(Date) } })
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

describe('restoreUnfinishedHeads (daatan#2159)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeleteMany.mockResolvedValue({ count: 1 } as never)
    mockUpdate.mockResolvedValue({} as never)
  })

  it('deletes an unfinished head and un-supersedes its parent with the content hash back', async () => {
    mockRows.mockResolvedValueOnce([{ id: 'h1', supersedesId: 'r1' }] as never)

    const n = await restoreUnfinishedHeads([row(1)])

    expect(n).toBe(1)
    expect(mockRows).toHaveBeenCalledWith({
      where: { supersedesId: { in: ['r1'] }, supersededAt: null, status: { in: ['FAILED'] } },
      select: { id: true, supersedesId: true },
    })
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { id: 'h1', supersededAt: null, status: { in: ['FAILED'] } },
    })
    // Delete before un-supersede: the partial unique index allows one current row per URL.
    expect(mockDeleteMany.mock.invocationCallOrder[0]).toBeLessThan(mockUpdate.mock.invocationCallOrder[0])
    const data = (mockUpdate.mock.calls[0][0] as { where: { id: string }; data: { supersededAt: null; contentHash: string } })
    expect(data.where.id).toBe('r1')
    expect(data.data.supersededAt).toBeNull()
    expect(data.data.contentHash).toBe(hashArticleContent('Headline 1', 'Body 1'))
  })

  it('leaves the parent superseded when a concurrent claim already moved the head on', async () => {
    mockRows.mockResolvedValueOnce([{ id: 'h1', supersedesId: 'r1' }] as never)
    mockDeleteMany.mockResolvedValueOnce({ count: 0 } as never)

    const n = await restoreUnfinishedHeads([row(1)])

    expect(n).toBe(0)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    mockRows.mockRejectedValueOnce(new Error('db down'))

    await expect(restoreUnfinishedHeads([row(1)])).resolves.toBe(0)
  })
})

describe('remediatePool restore wiring (daatan#2159)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPredictions.mockResolvedValue([PRED] as never)
    mockPrediction.mockResolvedValue({ confidence: 34 } as never)
    mockCount.mockResolvedValue(20)
    mockUpdateMany.mockResolvedValue({ count: 1 } as never)
    mockDeleteMany.mockResolvedValue({ count: 1 } as never)
    mockUpdate.mockResolvedValue({} as never)
  })

  it('reports rows the Oracul left out of an `ok` batch as restored, not lost', async () => {
    // 2026-11-12: every batch reported ok and failed:0 while 37 of 113 rows left the pool.
    mockRows
      .mockResolvedValueOnce([row(1), row(2), row(3)] as never) // target rows
      .mockResolvedValueOnce([{ id: 'h2', supersedesId: 'r2' }] as never) // unfinished heads
    mockRefresh.mockResolvedValue({ status: 'ok', sources: 2 })

    const r = await remediatePool(['p1'], true)

    expect(r.forecasts[0].ok).toBe(1)
    expect(r.forecasts[0].restored).toBe(1)
  })

  it('also restores still-PENDING heads when the batch threw', async () => {
    mockRows.mockResolvedValueOnce([row(1)] as never).mockResolvedValueOnce([] as never)
    mockRefresh.mockRejectedValue(new Error('boom'))

    await remediatePool(['p1'], true)

    expect(mockRows).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { in: ['FAILED', 'PENDING'] } }) }),
    )
  })
})
