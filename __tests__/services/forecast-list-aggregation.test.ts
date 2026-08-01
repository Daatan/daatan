/**
 * daatan#1203: listForecasts/enrichPredictions used to include the full
 * commitments relation per prediction and aggregate it in JS — cost scaled
 * with total commitment volume, not the page size. These tests pin the new
 * DB-side groupBy aggregation to the same values the old per-row JS math
 * produced, and verify the query count doesn't scale with commitment volume
 * (one batched groupBy per aggregate shape, not one query per prediction).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: {
      findMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    commitment: {
      groupBy: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

const basePrediction = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  outcomeType: 'BINARY',
  options: [],
  ...overrides,
})

describe('listForecasts + enrichPredictions — DB-side commitment aggregation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('computes totalCuCommitted, yesCount, noCount, communityProbability for a BINARY prediction', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { listForecasts, enrichPredictions } = await import('@/lib/services/forecast')

    vi.mocked(prisma.prediction.findMany).mockResolvedValue([basePrediction()] as any)
    // 3 groupBy calls in this fixed order: totals, byChoice, byOption
    vi.mocked(prisma.commitment.groupBy)
      .mockResolvedValueOnce([{ predictionId: 'p1', _sum: { cuCommitted: 60 }, _avg: { cuCommitted: 20 } }] as any)
      .mockResolvedValueOnce([
        { predictionId: 'p1', binaryChoice: true, _sum: { cuCommitted: 100 } },
        { predictionId: 'p1', binaryChoice: false, _sum: { cuCommitted: -40 } },
      ] as any)
      .mockResolvedValueOnce([] as any)

    const { predictions } = await listForecasts({
      where: {}, orderBy: { createdAt: 'desc' }, page: 1, limit: 20, isCuSort: false, sortOrder: 'desc',
    })
    const [result] = enrichPredictions(predictions, { page: 1, limit: 20, sortOrder: 'desc', isCuSort: false })

    // 80 (true) + 20 (true) - 40 (false) = 60 total; avg = 20 → (20+100)/200*100 = 60
    expect(result.totalCuCommitted).toBe(60)
    expect(result.communityProbability).toBe(60)
    expect(result.yesCount).toBe(100)
    expect(result.noCount).toBe(40) // abs(-40), not a raw negative sum
  })

  it('computes per-option commitmentsCount for a MULTIPLE_CHOICE prediction and leaves communityProbability null', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { listForecasts, enrichPredictions } = await import('@/lib/services/forecast')

    vi.mocked(prisma.prediction.findMany).mockResolvedValue([
      basePrediction({
        outcomeType: 'MULTIPLE_CHOICE',
        options: [{ id: 'optA', text: 'A' }, { id: 'optB', text: 'B' }],
      }),
    ] as any)
    vi.mocked(prisma.commitment.groupBy)
      .mockResolvedValueOnce([{ predictionId: 'p1', _sum: { cuCommitted: 30 }, _avg: { cuCommitted: 10 } }] as any)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([
        { predictionId: 'p1', optionId: 'optA', _count: { _all: 2 } },
        { predictionId: 'p1', optionId: 'optB', _count: { _all: 1 } },
      ] as any)

    const { predictions } = await listForecasts({
      where: {}, orderBy: { createdAt: 'desc' }, page: 1, limit: 20, isCuSort: false, sortOrder: 'desc',
    })
    const [result] = enrichPredictions(predictions, { page: 1, limit: 20, sortOrder: 'desc', isCuSort: false })

    expect(result.options.find(o => o.id === 'optA')?.commitmentsCount).toBe(2)
    expect(result.options.find(o => o.id === 'optB')?.commitmentsCount).toBe(1)
    expect(result.communityProbability).toBeNull() // not BINARY
  })

  it('returns zeroed aggregates for a prediction with no commitments', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { listForecasts, enrichPredictions } = await import('@/lib/services/forecast')

    vi.mocked(prisma.prediction.findMany).mockResolvedValue([basePrediction()] as any)
    vi.mocked(prisma.commitment.groupBy).mockResolvedValue([] as any)

    const { predictions } = await listForecasts({
      where: {}, orderBy: { createdAt: 'desc' }, page: 1, limit: 20, isCuSort: false, sortOrder: 'desc',
    })
    const [result] = enrichPredictions(predictions, { page: 1, limit: 20, sortOrder: 'desc', isCuSort: false })

    expect(result.totalCuCommitted).toBe(0)
    expect(result.communityProbability).toBeNull()
    expect(result.yesCount).toBe(0)
    expect(result.noCount).toBe(0)
    expect(result.userHasCommitted).toBe(false)
  })

  it('sets userHasCommitted only for predictions the given user actually committed to', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { listForecasts, enrichPredictions } = await import('@/lib/services/forecast')

    vi.mocked(prisma.prediction.findMany).mockResolvedValue([
      basePrediction({ id: 'p1' }),
      basePrediction({ id: 'p2' }),
    ] as any)
    vi.mocked(prisma.commitment.groupBy).mockResolvedValue([] as any)
    vi.mocked(prisma.commitment.findMany).mockResolvedValue([{ predictionId: 'p1' }] as any)

    const { predictions } = await listForecasts({
      where: {}, orderBy: { createdAt: 'desc' }, page: 1, limit: 20, isCuSort: false, sortOrder: 'desc',
      userId: 'user-1',
    })
    const result = enrichPredictions(predictions, { page: 1, limit: 20, sortOrder: 'desc', isCuSort: false })

    expect(result.find(p => p.id === 'p1')?.userHasCommitted).toBe(true)
    expect(result.find(p => p.id === 'p2')?.userHasCommitted).toBe(false)
    expect(prisma.commitment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { predictionId: { in: ['p1', 'p2'] }, userId: 'user-1' } }),
    )
  })

  it('skips the userHasCommitted lookup entirely when no userId is given (SSR path)', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { listForecasts } = await import('@/lib/services/forecast')

    vi.mocked(prisma.prediction.findMany).mockResolvedValue([basePrediction()] as any)
    vi.mocked(prisma.commitment.groupBy).mockResolvedValue([] as any)

    await listForecasts({
      where: {}, orderBy: { createdAt: 'desc' }, page: 1, limit: 20, isCuSort: false, sortOrder: 'desc',
    })

    expect(prisma.commitment.findMany).not.toHaveBeenCalled()
  })

  it('batches aggregation into one groupBy call per shape regardless of prediction count', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { listForecasts } = await import('@/lib/services/forecast')

    const many = Array.from({ length: 25 }, (_, i) => basePrediction({ id: `p${i}` }))
    vi.mocked(prisma.prediction.findMany).mockResolvedValue(many as any)
    vi.mocked(prisma.commitment.groupBy).mockResolvedValue([] as any)

    await listForecasts({
      where: {}, orderBy: { createdAt: 'desc' }, page: 1, limit: 25, isCuSort: false, sortOrder: 'desc',
    })

    // 3 groupBy shapes (totals, byChoice, byOption) — not 3×25 per-prediction queries.
    expect(prisma.commitment.groupBy).toHaveBeenCalledTimes(3)
  })

  it('skips all commitment queries when there are no predictions', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { listForecasts } = await import('@/lib/services/forecast')

    vi.mocked(prisma.prediction.findMany).mockResolvedValue([] as any)

    const { predictions } = await listForecasts({
      where: {}, orderBy: { createdAt: 'desc' }, page: 1, limit: 20, isCuSort: false, sortOrder: 'desc',
      userId: 'user-1',
    })

    expect(predictions).toEqual([])
    expect(prisma.commitment.groupBy).not.toHaveBeenCalled()
    expect(prisma.commitment.findMany).not.toHaveBeenCalled()
  })
})
