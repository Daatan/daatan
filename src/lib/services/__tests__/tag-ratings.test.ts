import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userTagRating: {
      count: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    punditTagRating: {
      count: vi.fn(),
      createMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/services/elo', () => ({
  replayEloHistory: vi.fn(),
  calculateEloUpdates: vi.fn(),
}))

vi.mock('@/lib/services/expertise', () => ({
  replayGlicko2History: vi.fn(),
  glicko2Update: vi.fn(),
}))

vi.mock('@/lib/services/pundit-rating', () => ({
  replayPunditEloHistory: vi.fn(),
  replayPunditGlickoHistory: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

describe('ensureTagRatingsSeeded', () => {
  beforeEach(() => vi.clearAllMocks())

  it('no-ops when rows already exist for the tag', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { replayEloHistory } = await import('@/lib/services/elo')
    const { ensureTagRatingsSeeded } = await import('../tag-ratings')

    vi.mocked(prisma.userTagRating.count).mockResolvedValue(5)

    await ensureTagRatingsSeeded('tag-1', 'crypto')

    expect(replayEloHistory).not.toHaveBeenCalled()
    expect(prisma.userTagRating.createMany).not.toHaveBeenCalled()
  })

  it('runs replay and seeds when count = 0', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { replayEloHistory } = await import('@/lib/services/elo')
    const { replayGlicko2History } = await import('@/lib/services/expertise')
    const { ensureTagRatingsSeeded } = await import('../tag-ratings')

    vi.mocked(prisma.userTagRating.count).mockResolvedValue(0)
    vi.mocked(replayEloHistory).mockResolvedValue(new Map([['u1', 1600], ['u2', 1400]]))
    vi.mocked(replayGlicko2History).mockResolvedValue(
      new Map([['u1', { mu: 1520, sigma: 300, volatility: 0.06, count: 3 }]]),
    )
    vi.mocked(prisma.userTagRating.createMany).mockResolvedValue({ count: 2 })

    await ensureTagRatingsSeeded('tag-1', 'crypto')

    expect(replayEloHistory).toHaveBeenCalledWith('crypto')
    expect(replayGlicko2History).toHaveBeenCalledWith('crypto')
    expect(prisma.userTagRating.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    )
    const { data } = vi.mocked(prisma.userTagRating.createMany).mock.calls[0][0] as any
    expect(data).toHaveLength(2)
    const u1 = data.find((r: any) => r.userId === 'u1')
    expect(u1.elo).toBe(1600)
    expect(u1.mu).toBe(1520)
    // u2 has no glicko entry → defaults
    const u2 = data.find((r: any) => r.userId === 'u2')
    expect(u2.mu).toBe(1500)
    expect(u2.sigma).toBe(350)
  })

  it('no-ops when replay produces no users', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { replayEloHistory } = await import('@/lib/services/elo')
    const { replayGlicko2History } = await import('@/lib/services/expertise')
    const { ensureTagRatingsSeeded } = await import('../tag-ratings')

    vi.mocked(prisma.userTagRating.count).mockResolvedValue(0)
    vi.mocked(replayEloHistory).mockResolvedValue(new Map())
    vi.mocked(replayGlicko2History).mockResolvedValue(new Map())

    await ensureTagRatingsSeeded('tag-1', 'crypto')

    expect(prisma.userTagRating.createMany).not.toHaveBeenCalled()
  })
})

describe('ensurePunditTagRatingsSeeded', () => {
  beforeEach(() => vi.clearAllMocks())

  it('no-ops when rows already exist for the tag', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { replayPunditEloHistory } = await import('@/lib/services/pundit-rating')
    const { ensurePunditTagRatingsSeeded } = await import('../tag-ratings')

    vi.mocked(prisma.punditTagRating.count).mockResolvedValue(3)

    await ensurePunditTagRatingsSeeded('tag-1', 'israeli-elections-2026')

    expect(replayPunditEloHistory).not.toHaveBeenCalled()
    expect(prisma.punditTagRating.createMany).not.toHaveBeenCalled()
  })

  it('runs replay and seeds when count = 0, carrying personName through', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { replayPunditEloHistory, replayPunditGlickoHistory } = await import('@/lib/services/pundit-rating')
    const { ensurePunditTagRatingsSeeded } = await import('../tag-ratings')

    vi.mocked(prisma.punditTagRating.count).mockResolvedValue(0)
    vi.mocked(replayPunditEloHistory).mockResolvedValue(new Map([['ben-caspit', 1580]]))
    vi.mocked(replayPunditGlickoHistory).mockResolvedValue(
      new Map([['ben-caspit', {
        mu: 1540, sigma: 300, volatility: 0.06,
        personName: 'Ben Caspit', totalPredictions: 4, correctPredictions: 3,
      }]]),
    )
    vi.mocked(prisma.punditTagRating.createMany).mockResolvedValue({ count: 1 })

    await ensurePunditTagRatingsSeeded('tag-1', 'israeli-elections-2026')

    expect(replayPunditEloHistory).toHaveBeenCalledWith('israeli-elections-2026')
    const { data } = vi.mocked(prisma.punditTagRating.createMany).mock.calls[0][0] as any
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      personId: 'ben-caspit', personName: 'Ben Caspit', tagId: 'tag-1',
      elo: 1580, mu: 1540, sigma: 300, totalPredictions: 4, correctPredictions: 3,
    })
  })

  it('no-ops when replay produces no pundits', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { replayPunditEloHistory, replayPunditGlickoHistory } = await import('@/lib/services/pundit-rating')
    const { ensurePunditTagRatingsSeeded } = await import('../tag-ratings')

    vi.mocked(prisma.punditTagRating.count).mockResolvedValue(0)
    vi.mocked(replayPunditEloHistory).mockResolvedValue(new Map())
    vi.mocked(replayPunditGlickoHistory).mockResolvedValue(new Map())

    await ensurePunditTagRatingsSeeded('tag-1', 'israeli-elections-2026')

    expect(prisma.punditTagRating.createMany).not.toHaveBeenCalled()
  })
})

describe('updateTagRatingsInTx', () => {
  beforeEach(() => vi.clearAllMocks())

  const mockTx = {
    userTagRating: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  } as any

  it('no-ops when tags is empty', async () => {
    const { updateTagRatingsInTx } = await import('../tag-ratings')
    await updateTagRatingsInTx(mockTx, [], [{ userId: 'u1', brierScore: 0.1 }])
    expect(mockTx.userTagRating.findMany).not.toHaveBeenCalled()
  })

  it('no-ops when commitments is empty', async () => {
    const { updateTagRatingsInTx } = await import('../tag-ratings')
    await updateTagRatingsInTx(mockTx, [{ id: 'tag-1' }], [])
    expect(mockTx.userTagRating.findMany).not.toHaveBeenCalled()
  })

  it('upserts one row per committer per tag', async () => {
    const { calculateEloUpdates } = await import('@/lib/services/elo')
    const { glicko2Update } = await import('@/lib/services/expertise')
    const { updateTagRatingsInTx } = await import('../tag-ratings')

    mockTx.userTagRating.findMany.mockResolvedValue([])
    mockTx.userTagRating.upsert.mockResolvedValue({})
    vi.mocked(calculateEloUpdates).mockReturnValue(new Map([['u1', 10], ['u2', -10]]))
    vi.mocked(glicko2Update).mockReturnValue({ mu: 1510, phi: 340, volatility: 0.06 })

    const tags = [{ id: 'tag-1' }, { id: 'tag-2' }]
    const commitments = [
      { userId: 'u1', brierScore: 0.05 },
      { userId: 'u2', brierScore: 0.40 },
    ]
    await updateTagRatingsInTx(mockTx, tags, commitments)

    // 2 tags × 2 users = 4 upserts
    expect(mockTx.userTagRating.upsert).toHaveBeenCalledTimes(4)
  })

  it('uses per-tag ELO from existing rows, not global', async () => {
    const { calculateEloUpdates } = await import('@/lib/services/elo')
    const { glicko2Update } = await import('@/lib/services/expertise')
    const { updateTagRatingsInTx } = await import('../tag-ratings')

    // u1 has a per-tag ELO of 1700 for tag-1
    mockTx.userTagRating.findMany.mockResolvedValue([
      { userId: 'u1', tagId: 'tag-1', elo: 1700, mu: 1550, sigma: 280, volatility: 0.055 },
    ])
    mockTx.userTagRating.upsert.mockResolvedValue({})
    vi.mocked(calculateEloUpdates).mockReturnValue(new Map([['u1', 5], ['u2', -5]]))
    vi.mocked(glicko2Update).mockReturnValue({ mu: 1510, phi: 340, volatility: 0.06 })

    await updateTagRatingsInTx(
      mockTx,
      [{ id: 'tag-1' }],
      [{ userId: 'u1', brierScore: 0.05 }, { userId: 'u2', brierScore: 0.30 }],
    )

    // calculateEloUpdates should be called with u1's per-tag ELO (1700), not 1500
    const eloInputs = vi.mocked(calculateEloUpdates).mock.calls[0][0]
    const u1Input = eloInputs.find((e: any) => e.userId === 'u1')
    expect(u1Input?.eloRating).toBe(1700)

    // glicko2Update for u1 should use per-tag mu/sigma/volatility
    const glickoCalls = vi.mocked(glicko2Update).mock.calls
    const u1Call = glickoCalls.find(([mu]) => mu === 1550)
    expect(u1Call).toBeDefined()
    expect(u1Call![1]).toBe(280)   // sigma
    expect(u1Call![2]).toBe(0.055) // volatility
  })

  it('skips ELO update when only 1 committer', async () => {
    const { calculateEloUpdates } = await import('@/lib/services/elo')
    const { glicko2Update } = await import('@/lib/services/expertise')
    const { updateTagRatingsInTx } = await import('../tag-ratings')

    mockTx.userTagRating.findMany.mockResolvedValue([])
    mockTx.userTagRating.upsert.mockResolvedValue({})
    vi.mocked(glicko2Update).mockReturnValue({ mu: 1510, phi: 340, volatility: 0.06 })

    await updateTagRatingsInTx(
      mockTx,
      [{ id: 'tag-1' }],
      [{ userId: 'u1', brierScore: 0.05 }],
    )

    // ELO not called with <2 committers
    expect(calculateEloUpdates).not.toHaveBeenCalled()
    // Glicko still runs
    expect(glicko2Update).toHaveBeenCalledTimes(1)
    // 1 upsert
    expect(mockTx.userTagRating.upsert).toHaveBeenCalledTimes(1)
    // create path: elo should be the default 1500 (no delta)
    const createData = mockTx.userTagRating.upsert.mock.calls[0][0].create
    expect(createData.elo).toBe(1500)
  })
})
