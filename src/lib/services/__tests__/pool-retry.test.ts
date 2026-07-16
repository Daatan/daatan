import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    evidencePoolArticle: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    prediction: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/services/oracle-backfill', () => ({
  refreshOracleSnapshot: (...a: unknown[]) => mockRefresh(...a),
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { prisma } from '@/lib/prisma'
import { retryPoolExtractions } from '../pool-retry'

const mockGroupBy = vi.mocked(prisma.evidencePoolArticle.groupBy)
const mockRows = vi.mocked(prisma.evidencePoolArticle.findMany)
const mockCount = vi.mocked(prisma.evidencePoolArticle.count)
const mockPredictions = vi.mocked(prisma.prediction.findMany)

function row(over: Record<string, unknown> = {}) {
  return {
    url: 'https://a.com/1',
    title: 'Stuck headline',
    source: 'a.com',
    publishedDate: '2026-07-09',
    ...over,
  }
}

describe('retryPoolExtractions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefresh.mockResolvedValue({ status: 'ok', sources: 1 })
    mockRows.mockResolvedValue([row()] as never)
    mockCount.mockResolvedValue(0)
  })

  it('sweeps the biggest ACTIVE-forecast backlogs first, up to the limit', async () => {
    mockGroupBy.mockResolvedValue([
      { predictionId: 'small', _count: { _all: 2 } },
      { predictionId: 'big', _count: { _all: 40 } },
      { predictionId: 'mid', _count: { _all: 10 } },
    ] as never)
    mockPredictions.mockResolvedValue([
      { id: 'small', claimText: 's', claimDirection: null, claimDeadline: null },
      { id: 'big', claimText: 'b', claimDirection: null, claimDeadline: null },
      { id: 'mid', claimText: 'm', claimDirection: null, claimDeadline: null },
    ] as never)

    const r = await retryPoolExtractions(2)

    expect(r.processed).toBe(2)
    expect(mockRefresh.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['big', 'mid'])
    // Only ACTIVE predictions were even considered
    const predWhere = mockPredictions.mock.calls[0][0] as { where: { status: string } }
    expect(predWhere.where.status).toBe('ACTIVE')
  })

  it('re-drives rows as title-only articles under origin retry', async () => {
    mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 1 } }] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'Will X happen?', claimDirection: 'YES', claimDeadline: null },
    ] as never)

    await retryPoolExtractions(3)

    expect(mockRefresh).toHaveBeenCalledWith(
      { id: 'p1', claimText: 'Will X happen?', claimDirection: 'YES', claimDeadline: null },
      {
        articles: [
          // The pool never stored the snippet — retried articles carry title only.
          { url: 'https://a.com/1', title: 'Stuck headline', snippet: '', source: 'a.com', publishedDate: '2026-07-09' },
        ],
        origin: 'retry',
      },
    )
  })

  it('excludes oracle_omitted rows — judged irrelevant is terminal, not retryable', async () => {
    mockGroupBy.mockResolvedValue([] as never)
    mockPredictions.mockResolvedValue([] as never)

    await retryPoolExtractions(3)

    const where = (mockGroupBy.mock.calls[0][0] as { where: { OR: unknown[] } }).where
    expect(where).toMatchObject({ excluded: false, title: { not: null } })
    expect(where.OR).toEqual([
      { status: 'FAILED', statusReason: null },
      { status: 'FAILED', statusReason: { not: 'oracle_omitted' } },
      { status: 'PENDING' },
    ])
  })

  it('tallies outcomes per prediction and reports the remaining backlog', async () => {
    mockGroupBy.mockResolvedValue([
      { predictionId: 'p1', _count: { _all: 3 } },
      { predictionId: 'p2', _count: { _all: 2 } },
      { predictionId: 'p3', _count: { _all: 1 } },
    ] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'a', claimDirection: null, claimDeadline: null },
      { id: 'p2', claimText: 'b', claimDirection: null, claimDeadline: null },
      { id: 'p3', claimText: 'c', claimDirection: null, claimDeadline: null },
    ] as never)
    mockRefresh
      .mockResolvedValueOnce({ status: 'ok', sources: 2 })
      .mockResolvedValueOnce({ status: 'no-oracle' })
      .mockRejectedValueOnce(new Error('boom'))
    mockCount.mockResolvedValue(4)

    const r = await retryPoolExtractions(5)

    expect(r).toMatchObject({ processed: 3, ok: 1, noOracle: 1, failed: 1, remaining: 4 })
  })

  it('skips a prediction whose retryable rows all lack a title', async () => {
    mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 1 } }] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'a', claimDirection: null, claimDeadline: null },
    ] as never)
    mockRows.mockResolvedValue([row({ title: null })] as never)

    const r = await retryPoolExtractions(3)

    expect(r.processed).toBe(0)
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
