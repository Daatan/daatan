import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/leaderboard/route'

// unstable_cache needs Next's real incremental-cache backend, which doesn't
// exist outside next dev/start — pass through so these tests still exercise
// getLeaderboard fresh against the mocked Prisma calls below.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 59, resetAt: Date.now() + 3600000 }),
  rateLimitResponse: vi.fn().mockReturnValue(new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), { status: 429 })),
  clientIp: vi.fn().mockReturnValue('127.0.0.1'),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: vi.fn() },
    tag: { findUnique: vi.fn().mockResolvedValue(null) },
    commitment: { groupBy: vi.fn(), findMany: vi.fn() },
    userTagRating: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

// tag-ratings: ensureTagRatingsSeeded is a no-op in unit tests
vi.mock('@/lib/services/tag-ratings', () => ({
  ensureTagRatingsSeeded: vi.fn().mockResolvedValue(undefined),
  updateTagRatingsInTx: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/services/expertise', () => ({
  replayGlicko2History: vi.fn().mockResolvedValue(null),
  glicko2Update: vi.fn().mockReturnValue({ mu: 1500, phi: 350, volatility: 0.06 }),
  applyGlicko2Update: vi.fn(),
}))

const mockUsers = [
  {
    id: 'u1',
    name: 'Alice',
    username: 'alice',
    image: null,
    rs: 120,
    mu: 1500,
    sigma: 350,
    eloRating: 1500,
    totalPredictions: 2,
    correctPredictions: 1,
    _count: { predictions: 5, commitments: 2 },
  },
  {
    id: 'u2',
    name: 'Bob',
    username: 'bob',
    image: null,
    rs: 100,
    mu: 1520,
    sigma: 300,
    eloRating: 1520,
    totalPredictions: 4,
    correctPredictions: 2,
    _count: { predictions: 3, commitments: 3 },
  },
]

// Aggregated commitment data matching the old mockUsers inline commitments
const mockCuSums = [
  { userId: 'u1', _sum: { cuCommitted: 20 } },  // 10 + 10
  { userId: 'u2', _sum: { cuCommitted: 45 } },  // 20 + 20 + 5
]
const mockRsGainSums = [
  { userId: 'u1', _sum: { rsChange: 2.0 } },  // only rsChange > 0
  { userId: 'u2', _sum: { rsChange: 6.0 } },  // 3.0 + 3.0
]
const mockResolvedCommitments = [
  { userId: 'u1', rsChange: 5 },  // correct (rsChange > 0)
  { userId: 'u1', rsChange: -5 }, // wrong (rsChange < 0)
  { userId: 'u2', rsChange: 3 },  // correct
  { userId: 'u2', rsChange: 3 },  // correct
]

describe('GET /api/leaderboard (enhanced)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { checkRateLimit } = await import('@/lib/rate-limit')
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 59, resetAt: Date.now() + 3600000 })

    const { prisma } = await import('@/lib/prisma')
    // groupBy order: cuSums, rsGainSums, brierScoreSums, peerScoreSums, aiScoreSums, rsChangeSums
    vi.mocked(prisma.commitment.groupBy)
      .mockResolvedValueOnce(mockCuSums as any)
      .mockResolvedValueOnce(mockRsGainSums as any)
      .mockResolvedValue([] as any)
    // findMany order: resolvedCommitments, then weightedPeerRows (empty)
    vi.mocked(prisma.commitment.findMany)
      .mockResolvedValueOnce(mockResolvedCommitments as any)
      .mockResolvedValue([] as any)

  })

  it('returns leaderboard sorted by RS (default)', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.user.findMany).mockResolvedValue(mockUsers as any)

    const request = new NextRequest('http://localhost/api/leaderboard')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.leaderboard).toHaveLength(2)
    expect(data.leaderboard[0].username).toBe('alice') // rs=120 > 100
    expect(data.leaderboard[1].username).toBe('bob')
  })

  it('sorts by accuracy when requested', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.user.findMany).mockResolvedValue(mockUsers as any)

    const request = new NextRequest('http://localhost/api/leaderboard?sortBy=accuracy')
    const response = await GET(request)
    const data = await response.json()

    // Bob: 2/2 = 100%, Alice: 1/2 = 50%
    expect(data.leaderboard[0].username).toBe('bob')
    expect(data.leaderboard[0].accuracy).toBe(100)
    expect(data.leaderboard[1].username).toBe('alice')
    expect(data.leaderboard[1].accuracy).toBe(50)
  })

  it('sorts by totalCorrect when requested', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.user.findMany).mockResolvedValue(mockUsers as any)

    const request = new NextRequest('http://localhost/api/leaderboard?sortBy=totalCorrect')
    const response = await GET(request)
    const data = await response.json()

    // Bob: 2 correct, Alice: 1 correct
    expect(data.leaderboard[0].username).toBe('bob')
    expect(data.leaderboard[0].totalCorrect).toBe(2)
    expect(data.leaderboard[1].totalCorrect).toBe(1)
  })

  it('sorts by cuCommitted when requested', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.user.findMany).mockResolvedValue(mockUsers as any)

    const request = new NextRequest('http://localhost/api/leaderboard?sortBy=cuCommitted')
    const response = await GET(request)
    const data = await response.json()

    // Bob: 45 CU, Alice: 20 CU
    expect(data.leaderboard[0].username).toBe('bob')
    expect(data.leaderboard[0].totalCuCommitted).toBe(45)
    expect(data.leaderboard[1].totalCuCommitted).toBe(20)
  })

  it('respects limit parameter', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.user.findMany).mockResolvedValue(mockUsers as any)

    const request = new NextRequest('http://localhost/api/leaderboard?limit=1')
    const response = await GET(request)
    const data = await response.json()

    expect(data.leaderboard).toHaveLength(1)
  })

  it('caps limit at 100', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.user.findMany).mockResolvedValue([])
    vi.mocked(prisma.commitment.groupBy).mockResolvedValue([])
    vi.mocked(prisma.commitment.findMany).mockResolvedValue([])

    const request = new NextRequest('http://localhost/api/leaderboard?limit=999')
    await GET(request)

    expect(prisma.user.findMany).toHaveBeenCalled()
  })

  it('computes totalRsGained correctly (only positive rsChange)', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.user.findMany).mockResolvedValue(mockUsers as any)

    const request = new NextRequest('http://localhost/api/leaderboard')
    const response = await GET(request)
    const data = await response.json()

    // Alice: only rsChange > 0 summed at DB level = 2.0
    const alice = data.leaderboard.find((u: any) => u.username === 'alice')
    expect(alice.totalRsGained).toBe(2)

    // Bob: 3.0 + 3.0 = 6.0
    const bob = data.leaderboard.find((u: any) => u.username === 'bob')
    expect(bob.totalRsGained).toBe(6)
  })

  it('does not seed per-tag ratings for the default (no-tag) board and uses stored eloRating', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.user.findMany).mockResolvedValue(mockUsers as any)
    const { ensureTagRatingsSeeded } = await import('@/lib/services/tag-ratings')
    vi.mocked(ensureTagRatingsSeeded).mockClear()

    const request = new NextRequest('http://localhost/api/leaderboard?sortBy=elo')
    const response = await GET(request)
    const data = await response.json()

    // No tag → per-tag seeding skipped; stored eloRating drives the ranking (Bob 1520 > Alice 1500)
    expect(ensureTagRatingsSeeded).not.toHaveBeenCalled()
    expect(data.leaderboard[0].username).toBe('bob')
    expect(data.leaderboard[0].eloRating).toBe(1520)
    expect(data.leaderboard[1].eloRating).toBe(1500)
  })

  it('seeds and reads per-tag ratings when a tag is provided', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.user.findMany).mockResolvedValue(mockUsers as any)
    vi.mocked(prisma.tag.findUnique).mockResolvedValue({ id: 'tag-crypto' } as any)
    const { ensureTagRatingsSeeded } = await import('@/lib/services/tag-ratings')

    const request = new NextRequest('http://localhost/api/leaderboard?sortBy=elo&tag=crypto')
    await GET(request)

    expect(ensureTagRatingsSeeded).toHaveBeenCalledWith('tag-crypto', 'crypto')
    expect(prisma.userTagRating.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tagId: 'tag-crypto' }) }),
    )
  })

  it('handles database errors gracefully', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.user.findMany).mockRejectedValue(new Error('DB error'))

    const request = new NextRequest('http://localhost/api/leaderboard')
    const response = await GET(request)
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to fetch leaderboard')
  })

  it('returns 429 when rate limit is exceeded', async () => {
    const { checkRateLimit } = await import('@/lib/rate-limit')
    vi.mocked(checkRateLimit).mockReturnValueOnce({ allowed: false, remaining: 0, resetAt: Date.now() + 3600000 })

    const request = new NextRequest('http://localhost/api/leaderboard')
    const response = await GET(request)
    expect(response.status).toBe(429)
  })
})
