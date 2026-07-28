import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tag: { findUnique: vi.fn() },
    punditTagRating: { findMany: vi.fn() },
    prediction: { count: vi.fn() },
  },
}))

vi.mock('@/lib/services/tag-ratings', () => ({
  ensurePunditTagRatingsSeeded: vi.fn(),
}))

describe('getPunditLeaderboard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns an empty board when the tag does not exist', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue(null)

    const { getPunditLeaderboard } = await import('../pundit-leaderboard')
    const board = await getPunditLeaderboard('israeli-elections-2026')

    expect(board).toEqual({ entries: [], minResolved: 3, belowMinimum: 0, activePredictions: 0 })
  })

  it('excludes pundits below the minimum resolved-prediction floor', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({ id: 'tag-1' } as any)
    vi.mocked(prisma.punditTagRating.findMany).mockResolvedValue([
      { personId: 'a', personName: 'A', elo: 1600, mu: 1600, sigma: 200, totalPredictions: 5, correctPredictions: 4 },
      { personId: 'b', personName: 'B', elo: 1450, mu: 1450, sigma: 340, totalPredictions: 1, correctPredictions: 0 },
    ] as any)
    vi.mocked(prisma.prediction.count).mockResolvedValue(7)

    const { getPunditLeaderboard } = await import('../pundit-leaderboard')
    const board = await getPunditLeaderboard('israeli-elections-2026', 3)

    expect(board.entries).toHaveLength(1)
    expect(board.entries[0].personId).toBe('a')
    expect(board.belowMinimum).toBe(1)
    expect(board.activePredictions).toBe(7)
  })

  it('ranks by glickoRank (mu - 3*sigma) descending, not raw mu', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({ id: 'tag-1' } as any)
    vi.mocked(prisma.punditTagRating.findMany).mockResolvedValue([
      // higher mu but much higher uncertainty (sigma) -> lower glickoRank
      { personId: 'volatile', personName: 'Volatile', elo: 1650, mu: 1650, sigma: 300, totalPredictions: 3, correctPredictions: 2 },
      // lower mu but low uncertainty -> higher glickoRank
      { personId: 'steady', personName: 'Steady', elo: 1580, mu: 1580, sigma: 50, totalPredictions: 10, correctPredictions: 9 },
    ] as any)
    vi.mocked(prisma.prediction.count).mockResolvedValue(0)

    const { getPunditLeaderboard } = await import('../pundit-leaderboard')
    const board = await getPunditLeaderboard('israeli-elections-2026', 3)

    expect(board.entries.map(e => e.personId)).toEqual(['steady', 'volatile'])
  })

  it('computes accuracy as correctPredictions/totalPredictions', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({ id: 'tag-1' } as any)
    vi.mocked(prisma.punditTagRating.findMany).mockResolvedValue([
      { personId: 'a', personName: 'A', elo: 1500, mu: 1500, sigma: 350, totalPredictions: 4, correctPredictions: 3 },
    ] as any)
    vi.mocked(prisma.prediction.count).mockResolvedValue(0)

    const { getPunditLeaderboard } = await import('../pundit-leaderboard')
    const board = await getPunditLeaderboard('israeli-elections-2026', 3)

    expect(board.entries[0].accuracy).toBe(0.75)
  })
})
