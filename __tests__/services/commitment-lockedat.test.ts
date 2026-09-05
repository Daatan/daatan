/**
 * TEST-2: Verifies that createCommitment sets lockedAt on the prediction
 * when the first commitment is made, and does NOT update lockedAt for
 * subsequent commitments.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => {
  const txClient = {
    commitment: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    prediction: { update: vi.fn() },
    user: { update: vi.fn() },
    // AI panel: the commit path snapshots the run current at commit time.
    aiEstimateRun: { findFirst: vi.fn() },
  }
  return {
    prisma: {
      commitment: { findUnique: vi.fn() },
      prediction: { findUnique: vi.fn() },
      // Latest non-clock snapshot (abstention flag) is its own findFirst now, not a nested take.
      contextSnapshot: { findFirst: vi.fn() },
      user: { findUnique: vi.fn() },
      // Execute the callback synchronously with the tx client
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txClient) => unknown) => cb(txClient)),
      _txClient: txClient,
    },
  }
})

vi.mock('@/lib/services/telegram', () => ({ notifyNewCommitment: vi.fn(), notifyServerError: vi.fn() }))
vi.mock('@/lib/services/notification', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/services/ai-estimate', () => ({ triggerAiProbabilityEstimate: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

function makePrediction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pred-1',
    status: 'ACTIVE',
    outcomeType: 'BINARY',
    authorId: 'author-1',
    claimText: 'Will X happen?',
    slug: 'will-x-happen',
    lockedAt: null,
    options: [],
    ...overrides,
  }
}

function makeUser() {
  return { id: 'user-1', rs: 100, isBot: false }
}

function makeCreatedCommitment() {
  return {
    id: 'c1',
    userId: 'user-1',
    predictionId: 'pred-1',
    binaryChoice: true,
    cuCommitted: 70,
    rsSnapshot: 100,
    createdAt: new Date(),
    user: { id: 'user-1', name: 'Alice', username: 'alice', image: null },
    option: null,
  }
}

describe('createCommitment — lockedAt behaviour', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets lockedAt on the prediction when this is the first commitment', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { createCommitment } = await import('@/lib/services/commitment')

    vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser() as any)
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(makePrediction() as any)

    const tx = (prisma as any)._txClient
    vi.mocked(tx.commitment.findMany).mockResolvedValue([])      // no prior commitments
    vi.mocked(tx.commitment.create).mockResolvedValue(makeCreatedCommitment() as any)
    vi.mocked(tx.prediction.update).mockResolvedValue({})

    const result = await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(result.ok).toBe(true)
    expect(tx.prediction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pred-1' },
        data: expect.objectContaining({ lockedAt: expect.any(Date) }),
      }),
    )
  })

  it('does NOT call prediction.update for a subsequent commitment', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { createCommitment } = await import('@/lib/services/commitment')

    vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser() as any)
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(
      makePrediction({ lockedAt: new Date() }) as any,
    )

    const tx = (prisma as any)._txClient
    vi.mocked(tx.commitment.findMany).mockResolvedValue([{ cuCommitted: 50 }]) // already has commitments
    vi.mocked(tx.commitment.create).mockResolvedValue(makeCreatedCommitment() as any)
    vi.mocked(tx.prediction.update).mockResolvedValue({})

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(tx.prediction.update).not.toHaveBeenCalled()
  })

  it('returns 400 when prediction is not ACTIVE', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { createCommitment } = await import('@/lib/services/commitment')

    vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser() as any)
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(
      makePrediction({ status: 'RESOLVED_CORRECT' }) as any,
    )

    const result = await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
  })
})
