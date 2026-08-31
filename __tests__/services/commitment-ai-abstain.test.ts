/**
 * When the Oracul abstained on a forecast (latest ContextSnapshot.insufficientData),
 * a commit with null Prediction.confidence must NOT trigger the LLM base-rate
 * backfill — the UI shows no AI estimate, so manufacturing one to grade the user's
 * aiScore against would defeat the abstention. Leaving aiProbabilityAtCommit null
 * makes aiScore simply skipped at resolution.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => {
  const txClient = {
    commitment: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn() },
    prediction: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
    // AI panel: the commit path snapshots the run current at commit time.
    // Unstubbed it resolves undefined, which the service maps to null.
    aiEstimateRun: { findFirst: vi.fn() },
  }
  return {
    prisma: {
      commitment: { findUnique: vi.fn() },
      prediction: { findUnique: vi.fn() },
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

function makePrediction(contextSnapshots: Array<{ insufficientData: boolean }>) {
  return {
    id: 'pred-1',
    status: 'ACTIVE',
    authorId: 'author-1',
    outcomeType: 'BINARY',
    claimText: 'Will X happen?',
    slug: 'will-x-happen',
    lockedAt: null,
    confidence: null,
    options: [],
    contextSnapshots,
  }
}

// No aiProbabilityAtCommit field ⇒ undefined ⇒ treated as null (the backfill path).
function makeCreatedCommitment() {
  return {
    id: 'c1',
    userId: 'user-1',
    predictionId: 'pred-1',
    binaryChoice: true,
    cuCommitted: 50,
    rsSnapshot: 100,
    createdAt: new Date(),
    user: { id: 'user-1', name: 'Alice', username: 'alice', image: null },
    option: null,
  }
}

async function commit(contextSnapshots: Array<{ insufficientData: boolean }>) {
  const { prisma } = await import('@/lib/prisma')
  const { createCommitment } = await import('@/lib/services/commitment')

  vi.mocked(prisma.prediction.findUnique).mockResolvedValue(makePrediction(contextSnapshots) as any)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1', rs: 100 } as any)
  vi.mocked(prisma.commitment.findUnique).mockResolvedValue(null)

  const tx = (prisma as any)._txClient
  vi.mocked(tx.commitment.findMany).mockResolvedValue([])
  vi.mocked(tx.commitment.create).mockResolvedValue(makeCreatedCommitment() as any)
  vi.mocked(tx.prediction.update).mockResolvedValue({})

  const result = await createCommitment('user-1', 'pred-1', { confidence: 50 })
  expect(result.ok).toBe(true)
  return import('@/lib/services/ai-estimate')
}

describe('createCommitment — AI base-rate backfill vs. abstention', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT backfill an LLM estimate when the Oracul abstained', async () => {
    const { triggerAiProbabilityEstimate } = await commit([{ insufficientData: true }])
    expect(triggerAiProbabilityEstimate).not.toHaveBeenCalled()
  })

  it('backfills an LLM estimate when the forecast was not analysed (no abstention)', async () => {
    const { triggerAiProbabilityEstimate } = await commit([{ insufficientData: false }])
    expect(triggerAiProbabilityEstimate).toHaveBeenCalledWith('c1', 'Will X happen?')
  })

  it('backfills when there is no snapshot at all (brand-new forecast)', async () => {
    const { triggerAiProbabilityEstimate } = await commit([])
    expect(triggerAiProbabilityEstimate).toHaveBeenCalledWith('c1', 'Will X happen?')
  })
})
