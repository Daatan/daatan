import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadProfileScores, loadProfileTab, PAGE_SIZE } from '@/lib/services/profile'

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

const {
  mockAggregate,
  mockCommitmentFindMany,
  mockPredictionFindMany,
  mockCount,
  mockTagFindMany,
  mockTagFindUnique,
  mockUserFindUnique,
  mockTagRatingFindUnique,
  mockEnsureTagRatingsSeeded,
} = vi.hoisted(() => ({
  mockAggregate: vi.fn(),
  mockCommitmentFindMany: vi.fn(),
  mockPredictionFindMany: vi.fn(),
  mockCount: vi.fn(),
  mockTagFindMany: vi.fn(),
  mockTagFindUnique: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockTagRatingFindUnique: vi.fn(),
  mockEnsureTagRatingsSeeded: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    commitment: {
      aggregate: mockAggregate,
      findMany: mockCommitmentFindMany,
      count: mockCount,
    },
    prediction: {
      findMany: mockPredictionFindMany,
      count: mockCount,
    },
    tag: {
      findMany: mockTagFindMany,
      findUnique: mockTagFindUnique,
    },
    user: {
      findUnique: mockUserFindUnique,
    },
    userTagRating: {
      findUnique: mockTagRatingFindUnique,
    },
  },
}))

vi.mock('@/lib/services/tag-ratings', () => ({
  ensureTagRatingsSeeded: mockEnsureTagRatingsSeeded,
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAggregateResult(overrides: Record<string, unknown> = {}) {
  return {
    _avg: { brierScore: null },
    _sum: { rsChange: null, peerScore: null, aiScore: null },
    _count: { brierScore: 0, rsChange: 0, peerScore: 0, aiScore: 0 },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// loadProfileScores
// ---------------------------------------------------------------------------

describe('loadProfileScores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUserFindUnique.mockResolvedValue({ eloRating: 1500 })
    mockTagFindUnique.mockResolvedValue({ id: 'tag-1' })
    mockTagRatingFindUnique.mockResolvedValue(null)
    mockEnsureTagRatingsSeeded.mockResolvedValue(undefined)
  })

  it('returns the global ELO when no tag is selected, without touching tag ratings', async () => {
    mockAggregate.mockResolvedValue(makeAggregateResult())
    mockCommitmentFindMany.mockResolvedValue([])
    mockTagFindMany.mockResolvedValue([])
    mockUserFindUnique.mockResolvedValue({ eloRating: 1587.4 })

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: null })

    expect(scores.elo).toBe(1587.4)
    expect(mockEnsureTagRatingsSeeded).not.toHaveBeenCalled()
    expect(mockTagRatingFindUnique).not.toHaveBeenCalled()
  })

  it('returns the materialized per-tag ELO when a tag is selected, seeding the tag first', async () => {
    mockAggregate.mockResolvedValue(makeAggregateResult())
    mockCommitmentFindMany.mockResolvedValue([])
    mockTagFindMany.mockResolvedValue([])
    mockTagFindUnique.mockResolvedValue({ id: 'tag-politics' })
    mockTagRatingFindUnique.mockResolvedValue({ elo: 1642 })

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: 'politics' })

    expect(scores.elo).toBe(1642)
    expect(mockEnsureTagRatingsSeeded).toHaveBeenCalledWith('tag-politics', 'politics')
    expect(mockTagRatingFindUnique).toHaveBeenCalledWith({
      where: { userId_tagId: { userId: 'u1', tagId: 'tag-politics' } },
      select: { elo: true },
    })
    expect(mockUserFindUnique).not.toHaveBeenCalled()
  })

  it('returns null ELO for a tag the user never resolved in (no row) — not the global value', async () => {
    mockAggregate.mockResolvedValue(makeAggregateResult())
    mockCommitmentFindMany.mockResolvedValue([])
    mockTagFindMany.mockResolvedValue([])
    mockTagRatingFindUnique.mockResolvedValue(null)

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: 'politics' })

    expect(scores.elo).toBeNull()
  })

  it('returns null ELO for an unknown tag slug', async () => {
    mockAggregate.mockResolvedValue(makeAggregateResult())
    mockCommitmentFindMany.mockResolvedValue([])
    mockTagFindMany.mockResolvedValue([])
    mockTagFindUnique.mockResolvedValue(null)

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: 'nope' })

    expect(scores.elo).toBeNull()
    expect(mockEnsureTagRatingsSeeded).not.toHaveBeenCalled()
  })

  it('returns null scores when no data', async () => {
    mockAggregate.mockResolvedValue(makeAggregateResult())
    mockCommitmentFindMany.mockResolvedValue([])
    mockTagFindMany.mockResolvedValue([])

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: null })

    expect(scores.avgBrierScore).toBeNull()
    expect(scores.brierCount).toBe(0)
    expect(scores.peerScoreSum).toBeNull()
    expect(scores.aiScoreSum).toBeNull()
    expect(scores.rsTagDelta).toBeNull()
    expect(scores.truthScore).toBeNull()
    expect(scores.roi).toBeNull()
    expect(scores.weightedPeerScore).toBeNull()
    expect(scores.accuracy).toBeNull()
    expect(scores.topicBreakdown).toEqual([])
    expect(scores.calibration).toEqual([])
  })

  it('computes avgBrierScore correctly', async () => {
    mockAggregate
      .mockResolvedValueOnce(
        makeAggregateResult({ _avg: { brierScore: 0.12345 }, _count: { brierScore: 5 } })
      )
      .mockResolvedValue(makeAggregateResult())
    mockCommitmentFindMany.mockResolvedValue([])
    mockTagFindMany.mockResolvedValue([])

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: null })
    expect(scores.avgBrierScore).toBe(0.123)
    expect(scores.brierCount).toBe(5)
  })

  it('computes truthScore when peerCount >= 3', async () => {
    // aggregate call order: brier, rsTag, peer, ai, rsNet
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult()) // brier
      .mockResolvedValueOnce(makeAggregateResult()) // rsTag
      .mockResolvedValueOnce(
        makeAggregateResult({ _sum: { peerScore: 0.6 }, _count: { peerScore: 3 } })
      ) // peer
      .mockResolvedValue(makeAggregateResult()) // ai + rsNet
    mockCommitmentFindMany.mockResolvedValue([])
    mockTagFindMany.mockResolvedValue([])

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: null })
    expect(scores.truthScore).toBe(0.2) // 0.6 / 3
    expect(scores.peerScoreCount).toBe(3)
  })

  it('returns null truthScore when peerCount < 3', async () => {
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult()) // brier
      .mockResolvedValueOnce(makeAggregateResult()) // rsTag
      .mockResolvedValueOnce(
        makeAggregateResult({ _sum: { peerScore: 0.4 }, _count: { peerScore: 2 } })
      ) // peer
      .mockResolvedValue(makeAggregateResult())
    mockCommitmentFindMany.mockResolvedValue([])
    mockTagFindMany.mockResolvedValue([])

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: null })
    expect(scores.truthScore).toBeNull()
  })

  it('computes roi when rsNetCount >= 3', async () => {
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult()) // brier
      .mockResolvedValueOnce(makeAggregateResult()) // rsTag
      .mockResolvedValueOnce(makeAggregateResult()) // peer
      .mockResolvedValueOnce(makeAggregateResult()) // ai
      .mockResolvedValueOnce(
        makeAggregateResult({ _sum: { rsChange: 9 }, _count: { rsChange: 3 } })
      ) // rsNet
    mockCommitmentFindMany.mockResolvedValue([])
    mockTagFindMany.mockResolvedValue([])

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: null })
    expect(scores.roi).toBe(3) // 9 / 3
  })

  it('returns null roi when rsNetCount < 3', async () => {
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult())
      .mockResolvedValueOnce(makeAggregateResult())
      .mockResolvedValueOnce(makeAggregateResult())
      .mockResolvedValueOnce(makeAggregateResult())
      .mockResolvedValueOnce(
        makeAggregateResult({ _sum: { rsChange: 9 }, _count: { rsChange: 2 } })
      )
    mockCommitmentFindMany.mockResolvedValue([])
    mockTagFindMany.mockResolvedValue([])

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: null })
    expect(scores.roi).toBeNull()
  })

  it('sets rsTagDelta only when selectedTag is provided', async () => {
    mockAggregate
      .mockResolvedValueOnce(makeAggregateResult()) // brier
      .mockResolvedValueOnce(makeAggregateResult({ _sum: { rsChange: 5 } })) // rsTag
      .mockResolvedValue(makeAggregateResult())
    mockCommitmentFindMany.mockResolvedValue([])
    mockTagFindMany.mockResolvedValue([])

    const withTag = await loadProfileScores({ userId: 'u1', selectedTag: 'ukraine' })
    expect(withTag.rsTagDelta).toBe(5)

    vi.clearAllMocks()
    mockAggregate.mockResolvedValue(makeAggregateResult())
    mockCommitmentFindMany.mockResolvedValue([])
    mockTagFindMany.mockResolvedValue([])

    const withoutTag = await loadProfileScores({ userId: 'u1', selectedTag: null })
    expect(withoutTag.rsTagDelta).toBeNull()
  })

  it('computes accuracy from rsChange > 0 rows', async () => {
    mockAggregate.mockResolvedValue(makeAggregateResult())
    // findMany call order: weightedPeerRows, accuracyRows, calibrationRows
    mockCommitmentFindMany
      .mockResolvedValueOnce([]) // weightedPeerRows
      .mockResolvedValueOnce([
        { rsChange: 1.5 },
        { rsChange: 2 },
        { rsChange: -0.5 },
        { rsChange: 0.1 },
        { rsChange: 3 },
      ]) // accuracyRows
      .mockResolvedValueOnce([]) // calibrationRows
    mockTagFindMany.mockResolvedValue([])

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: null })
    expect(scores.accuracyResolved).toBe(5)
    expect(scores.accuracy).toBe(0.8) // 4/5
  })

  it('returns null accuracy when fewer than 3 resolved', async () => {
    mockAggregate.mockResolvedValue(makeAggregateResult())
    mockCommitmentFindMany
      .mockResolvedValueOnce([]) // weightedPeerRows
      .mockResolvedValueOnce([{ rsChange: 1 }, { rsChange: -1 }]) // accuracyRows (2 < 3)
      .mockResolvedValueOnce([]) // calibrationRows
    mockTagFindMany.mockResolvedValue([])

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: null })
    expect(scores.accuracy).toBeNull()
  })

  it('computes weightedPeerScore with decay (same-day resolutions)', async () => {
    mockAggregate.mockResolvedValue(makeAggregateResult())
    const now = Date.now()
    const todayRows = [0.1, 0.2, 0.3].map(ps => ({
      peerScore: ps,
      prediction: { resolvedAt: new Date(now) },
    }))
    mockCommitmentFindMany
      .mockResolvedValueOnce(todayRows) // weightedPeerRows
      .mockResolvedValueOnce([]) // accuracyRows
      .mockResolvedValueOnce([]) // calibrationRows
    mockTagFindMany.mockResolvedValue([])

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: null })
    // sum=0.6, total weight=3 (decay^0=1 each) → avg=0.2
    expect(scores.weightedPeerScore).toBeCloseTo(0.2, 3)
  })

  it('weights older resolutions lower than recent ones', async () => {
    mockAggregate.mockResolvedValue(makeAggregateResult())
    const now = Date.now()
    const msPerDay = 86_400_000
    // 3 rows: one resolved 90 days ago (low weight), two resolved today (high weight)
    const rows = [
      { peerScore: 1.0, prediction: { resolvedAt: new Date(now - 90 * msPerDay) } }, // low weight
      { peerScore: 0.0, prediction: { resolvedAt: new Date(now) } },
      { peerScore: 0.0, prediction: { resolvedAt: new Date(now) } },
    ]
    mockCommitmentFindMany
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // calibrationRows
    mockTagFindMany.mockResolvedValue([])

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: null })
    // Weighted average should be lower than the simple average (1+0+0)/3 = 0.333
    expect(scores.weightedPeerScore).not.toBeNull()
    expect(scores.weightedPeerScore!).toBeLessThan(1 / 3)
  })

  it('buckets calibration data and computes actual outcome rate', async () => {
    mockAggregate.mockResolvedValue(makeAggregateResult())
    mockCommitmentFindMany
      .mockResolvedValueOnce([]) // weightedPeerRows
      .mockResolvedValueOnce([]) // accuracyRows
      .mockResolvedValueOnce([
        // bucket 7 (0.7–0.8): 2 correct, 1 wrong → actual = 0.667
        { probability: 0.75, prediction: { status: 'RESOLVED_CORRECT' } },
        { probability: 0.72, prediction: { status: 'RESOLVED_CORRECT' } },
        { probability: 0.78, prediction: { status: 'RESOLVED_WRONG' } },
        // bucket 3 (0.3–0.4): 1 correct → actual = 1.0
        { probability: 0.35, prediction: { status: 'RESOLVED_CORRECT' } },
      ]) // calibrationRows
    mockTagFindMany.mockResolvedValue([])

    const scores = await loadProfileScores({ userId: 'u1', selectedTag: null })
    expect(scores.calibration).toHaveLength(2)

    const b7 = scores.calibration.find(c => Math.abs(c.predicted - 0.75) < 0.01)
    expect(b7).toBeDefined()
    expect(b7!.count).toBe(3)
    expect(b7!.actual).toBeCloseTo(2 / 3, 5)

    const b3 = scores.calibration.find(c => Math.abs(c.predicted - 0.35) < 0.01)
    expect(b3).toBeDefined()
    expect(b3!.count).toBe(1)
    expect(b3!.actual).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// loadProfileTab
// ---------------------------------------------------------------------------

describe('loadProfileTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses PAGE_SIZE = 20', () => {
    expect(PAGE_SIZE).toBe(20)
  })

  it('returns created items on created tab', async () => {
    mockCount.mockResolvedValue(1)
    const fakePrediction = { id: 'p1', claimText: 'Will X happen?', author: {}, _count: {} }
    mockPredictionFindMany.mockResolvedValue([fakePrediction])

    const result = await loadProfileTab({
      userId: 'u1',
      isPublic: true,
      selectedTag: null,
      tab: 'created',
      page: 1,
    })

    expect(result.tab).toBe('created')
    expect(result.createdItems).toHaveLength(1)
    expect(result.participatedItems).toHaveLength(0)
    expect(result.resolvedItems).toHaveLength(0)
  })

  it('returns participated items on participated tab', async () => {
    mockCount.mockResolvedValue(5)
    const fakeCommitment = {
      id: 'c1',
      probability: 0.7,
      binaryChoice: null,
      cuCommitted: 100,
      brierScore: null,
      peerScore: null,
      rsChange: null,
      createdAt: new Date(),
      prediction: { id: 'p1', claimText: 'Will X?', author: {}, _count: {} },
    }
    mockCommitmentFindMany.mockResolvedValue([fakeCommitment])

    const result = await loadProfileTab({
      userId: 'u1',
      isPublic: true,
      selectedTag: null,
      tab: 'participated',
      page: 1,
    })

    expect(result.tab).toBe('participated')
    expect(result.participatedItems).toHaveLength(1)
    expect(result.createdItems).toHaveLength(0)
    expect(result.resolvedItems).toHaveLength(0)
  })

  it('returns resolved items on resolved tab', async () => {
    mockCount.mockResolvedValue(2)
    const fakeCommitment = {
      id: 'c2',
      probability: 0.8,
      binaryChoice: null,
      cuCommitted: 50,
      brierScore: 0.04,
      peerScore: 0.1,
      rsChange: 2.5,
      createdAt: new Date(),
      prediction: { id: 'p2', claimText: 'Will Y?', author: {}, _count: {} },
    }
    mockCommitmentFindMany.mockResolvedValue([fakeCommitment])

    const result = await loadProfileTab({
      userId: 'u1',
      isPublic: true,
      selectedTag: null,
      tab: 'resolved',
      page: 1,
    })

    expect(result.tab).toBe('resolved')
    expect(result.resolvedItems).toHaveLength(1)
    expect(result.participatedItems).toHaveLength(0)
  })

  it('includes total counts for all tabs regardless of active tab', async () => {
    mockCount
      .mockResolvedValueOnce(10) // createdTotal
      .mockResolvedValueOnce(25) // participatedTotal
      .mockResolvedValueOnce(8)  // resolvedTotal
    mockPredictionFindMany.mockResolvedValue([])

    const result = await loadProfileTab({
      userId: 'u1',
      isPublic: true,
      selectedTag: null,
      tab: 'created',
      page: 1,
    })

    expect(result.createdTotal).toBe(10)
    expect(result.participatedTotal).toBe(25)
    expect(result.resolvedTotal).toBe(8)
  })

  it('applies skip offset based on page number', async () => {
    mockCount.mockResolvedValue(100)
    mockPredictionFindMany.mockResolvedValue([])

    await loadProfileTab({
      userId: 'u1',
      isPublic: true,
      selectedTag: null,
      tab: 'created',
      page: 3,
    })

    const findManyCall = mockPredictionFindMany.mock.calls[0][0]
    expect(findManyCall.skip).toBe(40) // (3-1) * 20
    expect(findManyCall.take).toBe(PAGE_SIZE)
  })

  it('applies isPublic filter on created tab', async () => {
    mockCount.mockResolvedValue(0)
    mockPredictionFindMany.mockResolvedValue([])

    await loadProfileTab({
      userId: 'u1',
      isPublic: true,
      selectedTag: null,
      tab: 'created',
      page: 1,
    })

    const findManyCall = mockPredictionFindMany.mock.calls[0][0]
    expect(findManyCall.where.isPublic).toBe(true)
  })

  it('omits isPublic filter when isPublic=false (own profile)', async () => {
    mockCount.mockResolvedValue(0)
    mockPredictionFindMany.mockResolvedValue([])

    await loadProfileTab({
      userId: 'u1',
      isPublic: false,
      selectedTag: null,
      tab: 'created',
      page: 1,
    })

    const findManyCall = mockPredictionFindMany.mock.calls[0][0]
    expect(findManyCall.where.isPublic).toBeUndefined()
  })
})
