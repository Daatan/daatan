/**
 * TEST-9: Commitment confidence boundary values.
 * BINARY range is -100..100 (sign = binaryChoice direction).
 * MULTIPLE_CHOICE range is 0..100; the service enforces this explicitly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => {
  const txClient = {
    commitment: {
      findMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    prediction: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
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
    authorId: 'author-1',
    outcomeType: 'BINARY',
    claimText: 'Will X happen?',
    slug: 'will-x-happen',
    lockedAt: null,
    options: [],
    ...overrides,
  }
}

function makeUser() {
  return { id: 'user-1', rs: 100 }
}

function makeCreatedCommitment(confidence: number) {
  return {
    id: 'c1',
    userId: 'user-1',
    predictionId: 'pred-1',
    binaryChoice: confidence >= 0,
    cuCommitted: confidence,
    rsSnapshot: 100,
    createdAt: new Date(),
    user: { id: 'user-1', name: 'Alice', username: 'alice', image: null },
    option: null,
  }
}

describe('createCommitment — BINARY confidence boundary values', () => {
  beforeEach(() => vi.clearAllMocks())

  async function commitBinary(confidence: number) {
    const { prisma } = await import('@/lib/prisma')
    const { createCommitment } = await import('@/lib/services/commitment')

    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(makePrediction() as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser() as any)
    vi.mocked(prisma.commitment.findUnique).mockResolvedValue(null)

    const tx = (prisma as any)._txClient
    vi.mocked(tx.commitment.findMany).mockResolvedValue([])
    vi.mocked(tx.commitment.create).mockResolvedValue(makeCreatedCommitment(confidence) as any)
    vi.mocked(tx.prediction.update).mockResolvedValue({})

    return createCommitment('user-1', 'pred-1', { confidence })
  }

  it('accepts confidence = 0 (neutral, treated as binaryChoice=true)', async () => {
    const result = await commitBinary(0)
    expect(result.ok).toBe(true)
  })

  it('accepts confidence = -100 (maximum "No" certainty)', async () => {
    const result = await commitBinary(-100)
    expect(result.ok).toBe(true)
  })

  it('accepts confidence = +100 (maximum "Yes" certainty)', async () => {
    const result = await commitBinary(100)
    expect(result.ok).toBe(true)
  })

  it('derives binaryChoice=true for positive confidence', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { createCommitment } = await import('@/lib/services/commitment')

    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(makePrediction() as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser() as any)
    vi.mocked(prisma.commitment.findUnique).mockResolvedValue(null)

    const tx = (prisma as any)._txClient
    vi.mocked(tx.commitment.findMany).mockResolvedValue([])
    vi.mocked(tx.commitment.create).mockResolvedValue(makeCreatedCommitment(75) as any)
    vi.mocked(tx.prediction.update).mockResolvedValue({})

    await createCommitment('user-1', 'pred-1', { confidence: 75 })

    expect(tx.commitment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ binaryChoice: true, cuCommitted: 75 }),
      }),
    )
  })

  it('derives binaryChoice=false for negative confidence', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { createCommitment } = await import('@/lib/services/commitment')

    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(makePrediction() as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser() as any)
    vi.mocked(prisma.commitment.findUnique).mockResolvedValue(null)

    const tx = (prisma as any)._txClient
    vi.mocked(tx.commitment.findMany).mockResolvedValue([])
    vi.mocked(tx.commitment.create).mockResolvedValue(makeCreatedCommitment(-75) as any)
    vi.mocked(tx.prediction.update).mockResolvedValue({})

    await createCommitment('user-1', 'pred-1', { confidence: -75 })

    expect(tx.commitment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ binaryChoice: false, cuCommitted: -75 }),
      }),
    )
  })
})

describe('createCommitment — MULTIPLE_CHOICE confidence boundary values', () => {
  beforeEach(() => vi.clearAllMocks())

  const mcPrediction = makePrediction({
    outcomeType: 'MULTIPLE_CHOICE',
    options: [{ id: 'opt-1', text: 'Yes' }, { id: 'opt-2', text: 'No' }],
  })

  async function commitMC(confidence: number) {
    const { prisma } = await import('@/lib/prisma')
    const { createCommitment } = await import('@/lib/services/commitment')

    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(mcPrediction as any)
    vi.mocked(prisma.user.findUnique).mockResolvedValue(makeUser() as any)
    vi.mocked(prisma.commitment.findUnique).mockResolvedValue(null)

    const tx = (prisma as any)._txClient
    vi.mocked(tx.commitment.findMany).mockResolvedValue([])
    vi.mocked(tx.commitment.create).mockResolvedValue(makeCreatedCommitment(confidence) as any)
    vi.mocked(tx.prediction.update).mockResolvedValue({})

    return createCommitment('user-1', 'pred-1', { confidence, optionId: 'opt-1' })
  }

  it('accepts confidence = 0 (minimum valid)', async () => {
    const result = await commitMC(0)
    expect(result.ok).toBe(true)
  })

  it('accepts confidence = 100 (maximum valid)', async () => {
    const result = await commitMC(100)
    expect(result.ok).toBe(true)
  })

  it('returns 400 for confidence = -1 (below 0)', async () => {
    const result = await commitMC(-1)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
  })

  it('returns 400 for confidence = 101 (above 100)', async () => {
    const result = await commitMC(101)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
  })

  it('returns 400 for confidence = -100 (out of range)', async () => {
    const result = await commitMC(-100)
    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
  })
})
