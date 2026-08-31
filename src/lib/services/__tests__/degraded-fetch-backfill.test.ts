import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    evidencePoolArticle: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    prediction: { findMany: vi.fn() },
    contextSnapshot: { findFirst: vi.fn() },
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
  DEGRADED_FETCH_DOMAINS,
  CONFIRMED_DEGRADED_CUTOFF,
  degradedFetchWhere,
  sweepDegradedFetchRows,
  buildDegradedFetchDiffReport,
  type PredictionSnapshotPair,
} from '../degraded-fetch-backfill'
import { CONFIRMED_DEGRADED_URL_HASHES } from '../confirmed-degraded-urls'

const mockGroupBy = vi.mocked(prisma.evidencePoolArticle.groupBy)
const mockRows = vi.mocked(prisma.evidencePoolArticle.findMany)
const mockCount = vi.mocked(prisma.evidencePoolArticle.count)
const mockPredictions = vi.mocked(prisma.prediction.findMany)
const mockSnapshot = vi.mocked(prisma.contextSnapshot.findFirst)

function row(over: Record<string, unknown> = {}) {
  return {
    url: 'https://aa.com.tr/1',
    title: 'Degraded headline',
    snippet: null,
    source: 'aa.com.tr',
    publishedDate: '2026-07-20',
    ...over,
  }
}

function snapshot(over: Record<string, unknown> = {}) {
  return {
    id: 'snap1',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    externalProbability: 40,
    oracleSnapshot: { std: 5, ciLow: 30, ciHigh: 50 },
    ...over,
  }
}

describe('degradedFetchWhere', () => {
  it('selects COMPLETE rows on the 11 listed domains, older than the confirmed-degraded cutoff', () => {
    const where = degradedFetchWhere()
    expect(where).toEqual({
      status: 'COMPLETE',
      updatedAt: { lt: CONFIRMED_DEGRADED_CUTOFF },
      OR: [
        { source: { in: [...DEGRADED_FETCH_DOMAINS] } },
        { outletName: { in: [...DEGRADED_FETCH_DOMAINS] } },
      ],
    })
  })

  it('matches on source OR outletName, not just source', () => {
    const where = degradedFetchWhere()
    const or = where.OR as Array<Record<string, unknown>>
    expect(or[0]).toEqual({ source: { in: expect.arrayContaining(['reuters.com', 'lemonde.fr']) } })
    expect(or[1]).toEqual({ outletName: { in: expect.arrayContaining(['reuters.com', 'lemonde.fr']) } })
  })

  it('accepts a custom cutoff', () => {
    const cutoff = new Date('2020-01-01T00:00:00Z')
    const where = degradedFetchWhere({ cutoff })
    expect(where.updatedAt).toEqual({ lt: cutoff })
  })

  it('a urlHashAllowlist replaces the domain filter entirely', () => {
    const where = degradedFetchWhere({ urlHashAllowlist: ['h1', 'h2'] })
    expect(where).toEqual({
      status: 'COMPLETE',
      updatedAt: { lt: CONFIRMED_DEGRADED_CUTOFF },
      urlHash: { in: ['h1', 'h2'] },
    })
    expect(where.OR).toBeUndefined()
  })

  it('the generated allowlist is non-empty, deduped, and all sha256-shaped', () => {
    expect(CONFIRMED_DEGRADED_URL_HASHES.length).toBeGreaterThan(200)
    expect(new Set(CONFIRMED_DEGRADED_URL_HASHES).size).toBe(CONFIRMED_DEGRADED_URL_HASHES.length)
    for (const h of CONFIRMED_DEGRADED_URL_HASHES) {
      expect(h).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('the domain list is exactly the 11 domains the issue was scoped to', () => {
    expect([...DEGRADED_FETCH_DOMAINS].sort()).toEqual(
      [
        'aa.com.tr',
        'reuters.com',
        'nytimes.com',
        'bloomberg.com',
        'lemonde.fr',
        'msn.com',
        'thehill.com',
        'israelnationalnews.com',
        'middleeasteye.net',
        'phys.org',
        'aljazeera.net',
      ].sort(),
    )
  })
})

describe('sweepDegradedFetchRows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefresh.mockResolvedValue({ status: 'ok', sources: 1 })
    mockRows.mockResolvedValue([row()] as never)
    mockCount.mockResolvedValue(0)
    mockSnapshot.mockResolvedValue(snapshot() as never)
  })

  it('groups matching rows by prediction and re-drives the biggest backlogs first, up to the limit', async () => {
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

    const r = await sweepDegradedFetchRows(2)

    expect(r.processed).toBe(2)
    expect(mockRefresh.mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['big', 'mid'])
    const predWhere = mockPredictions.mock.calls[0][0] as { where: { status: string } }
    expect(predWhere.where.status).toBe('ACTIVE')
  })

  it('the row query used to build each batch is scoped by degradedFetchWhere, not the retry gate', async () => {
    mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 1 } }] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'a', claimDirection: null, claimDeadline: null },
    ] as never)

    await sweepDegradedFetchRows(3)

    const rowsWhere = mockRows.mock.calls[0][0] as { where: Record<string, unknown> }
    expect(rowsWhere.where).toMatchObject({ status: 'COMPLETE', predictionId: 'p1' })
  })

  it('re-drives rows with origin retry and reask enabled, same call shape as pool-retry', async () => {
    mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 1 } }] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'Will X happen?', claimDirection: 'YES', claimDeadline: null },
    ] as never)

    await sweepDegradedFetchRows(3)

    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(mockRefresh).toHaveBeenCalledWith(
      { id: 'p1', claimText: 'Will X happen?', claimDirection: 'YES', claimDeadline: null },
      {
        articles: [{ url: 'https://aa.com.tr/1', title: 'Degraded headline', snippet: '', source: 'aa.com.tr', publishedDate: '2026-07-20' }],
        origin: 'retry',
        reask: true,
      },
    )
  })

  it('skips a prediction whose matching rows all lack a title', async () => {
    mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 1 } }] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'a', claimDirection: null, claimDeadline: null },
    ] as never)
    mockRows.mockResolvedValue([row({ title: null })] as never)

    const r = await sweepDegradedFetchRows(3)

    expect(r.processed).toBe(0)
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('captures a before/after ContextSnapshot pair per prediction it actually ran', async () => {
    mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 1 } }] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'a', claimDirection: null, claimDeadline: null },
    ] as never)
    mockSnapshot
      .mockResolvedValueOnce(snapshot({ id: 'before', externalProbability: 40 }) as never)
      .mockResolvedValueOnce(snapshot({ id: 'after', externalProbability: 55 }) as never)

    const r = await sweepDegradedFetchRows(3)

    expect(r.diffs).toEqual([
      {
        predictionId: 'p1',
        before: expect.objectContaining({ id: 'before', mean: 40 }),
        after: expect.objectContaining({ id: 'after', mean: 55 }),
      },
    ])
  })

  it('still records a diff pair (after: null-ish) when refreshOracleSnapshot found nothing new', async () => {
    mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 1 } }] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'a', claimDirection: null, claimDeadline: null },
    ] as never)
    mockRefresh.mockResolvedValue({ status: 'unchanged' })
    mockSnapshot.mockResolvedValue(snapshot({ id: 'same', externalProbability: 40 }) as never)

    const r = await sweepDegradedFetchRows(3)

    expect(r.unchanged).toBe(1)
    expect(r.diffs[0].before).toEqual(r.diffs[0].after)
  })

  it('tallies outcomes and reports the remaining backlog', async () => {
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

    const r = await sweepDegradedFetchRows(5)

    expect(r).toMatchObject({ processed: 3, ok: 1, noOracul: 1, failed: 1, remaining: 4 })
    // The rejected prediction never got a diff pair recorded — nothing to diff.
    expect(r.diffs).toHaveLength(2)
  })

  it('reports gated (non-null contentHash) separately from the raw remaining count (daatan#1466)', async () => {
    mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 1 } }] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'a', claimDirection: null, claimDeadline: null },
    ] as never)
    mockRefresh.mockResolvedValue({ status: 'ok', sources: 1 })
    // call order: remainingBefore, gatedBefore, [loop has none], results.remaining, results.gated
    mockCount
      .mockResolvedValueOnce(140)
      .mockResolvedValueOnce(137)
      .mockResolvedValueOnce(140)
      .mockResolvedValueOnce(137)

    const r = await sweepDegradedFetchRows(5)

    expect(r.remaining).toBe(140)
    expect(r.gated).toBe(137)
  })

  it('never writes anything itself — refreshOracleSnapshot is the only mutation seam', async () => {
    mockGroupBy.mockResolvedValue([{ predictionId: 'p1', _count: { _all: 1 } }] as never)
    mockPredictions.mockResolvedValue([
      { id: 'p1', claimText: 'a', claimDirection: null, claimDeadline: null },
    ] as never)

    await sweepDegradedFetchRows(3)

    // read-only prisma calls only: groupBy / findMany / count / contextSnapshot.findFirst.
    expect(prisma.evidencePoolArticle).not.toHaveProperty('update')
    expect(prisma.evidencePoolArticle).not.toHaveProperty('updateMany')
  })
})

describe('buildDegradedFetchDiffReport', () => {
  function pair(over: Partial<PredictionSnapshotPair> = {}): PredictionSnapshotPair {
    return {
      predictionId: 'p',
      before: { id: 'b', createdAt: new Date('2026-08-01'), mean: 40, std: 5, ciLow: 30, ciHigh: 50 },
      after: { id: 'a', createdAt: new Date('2026-08-14'), mean: 55, std: 6, ciLow: 40, ciHigh: 70 },
      ...over,
    }
  }

  it('computes mean/std delta from before/after readings', () => {
    const [row] = buildDegradedFetchDiffReport([pair()])
    expect(row).toMatchObject({
      predictionId: 'p',
      meanBefore: 40,
      meanAfter: 55,
      meanDelta: 15,
      stdBefore: 5,
      stdAfter: 6,
      stdDelta: 1,
      movement: 15,
    })
  })

  it('sorts by movement magnitude, largest first, regardless of direction', () => {
    const report = buildDegradedFetchDiffReport([
      pair({ predictionId: 'small-up', before: { id: 'b', createdAt: new Date(), mean: 50, std: 5, ciLow: 40, ciHigh: 60 }, after: { id: 'a', createdAt: new Date(), mean: 52, std: 5, ciLow: 40, ciHigh: 60 } }),
      pair({ predictionId: 'big-down', before: { id: 'b', createdAt: new Date(), mean: 80, std: 5, ciLow: 70, ciHigh: 90 }, after: { id: 'a', createdAt: new Date(), mean: 40, std: 5, ciLow: 30, ciHigh: 50 } }),
      pair({ predictionId: 'mid-up', before: { id: 'b', createdAt: new Date(), mean: 30, std: 5, ciLow: 20, ciHigh: 40 }, after: { id: 'a', createdAt: new Date(), mean: 45, std: 5, ciLow: 35, ciHigh: 55 } }),
    ])

    expect(report.map((r) => r.predictionId)).toEqual(['big-down', 'mid-up', 'small-up'])
  })

  it('a negative delta still sorts by its absolute magnitude', () => {
    const [row] = buildDegradedFetchDiffReport([
      pair({ before: { id: 'b', createdAt: new Date(), mean: 90, std: 5, ciLow: 80, ciHigh: 100 }, after: { id: 'a', createdAt: new Date(), mean: 10, std: 5, ciLow: 0, ciHigh: 20 } }),
    ])
    expect(row.meanDelta).toBe(-80)
    expect(row.movement).toBe(80)
  })

  it('treats a missing before or after reading as unmeasurable movement (sorts last, not crashes)', () => {
    const report = buildDegradedFetchDiffReport([
      pair({ predictionId: 'measurable' }),
      pair({ predictionId: 'no-before', before: null }),
      pair({ predictionId: 'no-after', after: null }),
    ])

    const measurable = report.find((r) => r.predictionId === 'measurable')
    const noBefore = report.find((r) => r.predictionId === 'no-before')
    const noAfter = report.find((r) => r.predictionId === 'no-after')

    expect(measurable?.movement).toBeGreaterThan(0)
    expect(noBefore).toMatchObject({ meanDelta: null, movement: 0 })
    expect(noAfter).toMatchObject({ meanDelta: null, movement: 0 })
    // Unmeasurable rows never outrank a measurable one.
    expect(report.indexOf(measurable!)).toBeLessThan(report.indexOf(noBefore!))
  })

  it('an empty diff list produces an empty report', () => {
    expect(buildDegradedFetchDiffReport([])).toEqual([])
  })
})
