import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    evidencePoolArticle: {
      findMany: vi.fn(),
    },
  },
}))

describe('stanceToProbability / computePunditBrierScore', () => {
  it('maps stance -1..1 onto probability 0..1', async () => {
    const { stanceToProbability } = await import('../pundit-rating')
    expect(stanceToProbability(-1)).toBe(0)
    expect(stanceToProbability(0)).toBe(0.5)
    expect(stanceToProbability(1)).toBe(1)
  })

  it('is 0 for a perfectly confident correct call', async () => {
    const { computePunditBrierScore } = await import('../pundit-rating')
    expect(computePunditBrierScore(1, 1)).toBe(0)
  })

  it('is 1 for a perfectly confident wrong call', async () => {
    const { computePunditBrierScore } = await import('../pundit-rating')
    expect(computePunditBrierScore(1, 0)).toBe(1)
  })

  it('is 0.25 for a neutral stance regardless of outcome', async () => {
    const { computePunditBrierScore } = await import('../pundit-rating')
    expect(computePunditBrierScore(0, 1)).toBeCloseTo(0.25)
    expect(computePunditBrierScore(0, 0)).toBeCloseTo(0.25)
  })
})

describe('replayPunditEloHistory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('skips predictions with fewer than 2 distinct pundits', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.evidencePoolArticle.findMany).mockResolvedValue([
      {
        predictionId: 'p1', personId: 'ben-caspit', personName: 'Ben Caspit', stance: 0.8,
        prediction: { status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-01-01') },
      },
    ] as any)

    const { replayPunditEloHistory } = await import('../pundit-rating')
    const ratings = await replayPunditEloHistory('israeli-elections-2026')

    expect(ratings.size).toBe(0)
  })

  it('rewards the pundit with the lower brier score in a pairwise matchup', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.evidencePoolArticle.findMany).mockResolvedValue([
      {
        predictionId: 'p1', personId: 'right-pundit', personName: 'Right Pundit', stance: 1,
        prediction: { status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-01-01') },
      },
      {
        predictionId: 'p1', personId: 'wrong-pundit', personName: 'Wrong Pundit', stance: -1,
        prediction: { status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-01-01') },
      },
    ] as any)

    const { replayPunditEloHistory } = await import('../pundit-rating')
    const ratings = await replayPunditEloHistory('israeli-elections-2026')

    expect(ratings.get('right-pundit')!).toBeGreaterThan(1500)
    expect(ratings.get('wrong-pundit')!).toBeLessThan(1500)
  })

  it('averages multiple articles from the same pundit on the same prediction', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.evidencePoolArticle.findMany).mockResolvedValue([
      {
        predictionId: 'p1', personId: 'a', personName: 'A', stance: 1,
        prediction: { status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-01-01') },
      },
      {
        predictionId: 'p1', personId: 'a', personName: 'A', stance: 0,
        prediction: { status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-01-01') },
      },
      {
        predictionId: 'p1', personId: 'b', personName: 'B', stance: -1,
        prediction: { status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-01-01') },
      },
    ] as any)

    const { replayPunditEloHistory } = await import('../pundit-rating')
    const ratings = await replayPunditEloHistory('israeli-elections-2026')

    // a's average stance is 0.5 (brier 0.0625), beats b's -1 (brier 1) -> a wins
    expect(ratings.get('a')!).toBeGreaterThan(1500)
    expect(ratings.get('b')!).toBeLessThan(1500)
  })
})

describe('replayPunditGlickoHistory', () => {
  beforeEach(() => vi.clearAllMocks())

  it('tracks totalPredictions and correctPredictions per pundit', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.evidencePoolArticle.findMany).mockResolvedValue([
      {
        predictionId: 'p1', personId: 'a', personName: 'A', stance: 1,
        prediction: { status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-01-01') },
      },
      {
        predictionId: 'p2', personId: 'a', personName: 'A', stance: -1,
        prediction: { status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-02-01') },
      },
      {
        predictionId: 'p2', personId: 'b', personName: 'B', stance: 1,
        prediction: { status: 'RESOLVED_CORRECT', resolvedAt: new Date('2026-02-01') },
      },
    ] as any)

    const { replayPunditGlickoHistory } = await import('../pundit-rating')
    const ratings = await replayPunditGlickoHistory('israeli-elections-2026')

    expect(ratings.get('a')!.totalPredictions).toBe(2)
    expect(ratings.get('a')!.correctPredictions).toBe(1) // right on p1, wrong on p2
    expect(ratings.get('a')!.personName).toBe('A')
  })

  it('excludes rows with no personId, no stance, non-COMPLETE status, excluded, or superseded', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.evidencePoolArticle.findMany).mockResolvedValue([])

    const { replayPunditGlickoHistory, MIN_JUDGED_CERTAINTY } = await import('../pundit-rating')
    await replayPunditGlickoHistory('israeli-elections-2026')

    const whereClause = vi.mocked(prisma.evidencePoolArticle.findMany).mock.calls[0][0]!.where as any
    expect(whereClause.personId).toEqual({ not: null })
    expect(whereClause.stance).toEqual({ not: null })
    // A stance the extractor itself flagged as barely-confident shouldn't
    // move a pundit's track record. The Oracle's own aggregate (evidence-pool.ts)
    // is a separate query and is unaffected by this floor.
    expect(whereClause.certainty).toEqual({ gte: MIN_JUDGED_CERTAINTY })
    expect(whereClause.status).toBe('COMPLETE')
    expect(whereClause.excluded).toBe(false)
    // daatan#1699 — a superseded row is a replaced reading; averaging it in
    // alongside its replacement skews the pundit's stance, and their Brier score,
    // toward whatever the old extraction said.
    expect(whereClause.supersededAt).toBeNull()
    expect(whereClause.prediction.outcomeType).toBe('BINARY')
    expect(whereClause.prediction.tags).toEqual({ some: { slug: 'israeli-elections-2026' } })
  })
})
