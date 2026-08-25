import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Guards `Commitment.polymarketPrice` — Phase 2 of the expertise-rating plan
 * (docs/EXPERTISE_RATING_SYSTEM.md, daatan#1138). Reuses the existing
 * ExternalMarket link + price-snapshot history at commit time; no new
 * fetch/integration. Mirrors commitment-ai-run.test.ts's shape/rationale.
 */

const tx = {
  commitment: { findMany: vi.fn(), create: vi.fn() },
  aiEstimateRun: { findFirst: vi.fn() },
  externalMarketPriceSnapshot: { findFirst: vi.fn() },
  prediction: { update: vi.fn() },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    commitment: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/services/telegram', () => ({ notifyNewCommitment: vi.fn(), notifyServerError: vi.fn() }))
vi.mock('@/lib/services/notification', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/services/ai-estimate', () => ({ triggerAiProbabilityEstimate: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { createCommitment } from '../commitment'

const predictionFindUnique = vi.mocked(prisma.prediction.findUnique)
const userFindUnique = vi.mocked(prisma.user.findUnique)
const commitmentFindUnique = vi.mocked(prisma.commitment.findUnique)
const transaction = vi.mocked(prisma.$transaction)

function prediction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pred-1',
    status: 'ACTIVE',
    authorId: 'author-1',
    outcomeType: 'BINARY',
    claimText: 'A claim',
    slug: 'a-claim',
    lockedAt: null,
    settled: false,
    confidence: null,
    resolveByDatetime: new Date('2030-01-01'),
    claimDeadline: null,
    options: [],
    contextSnapshots: [],
    externalMarketId: null,
    externalMarketInverted: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  userFindUnique.mockResolvedValue({ id: 'user-1', rs: 100 } as never)
  commitmentFindUnique.mockResolvedValue(null)
  tx.commitment.findMany.mockResolvedValue([])
  tx.aiEstimateRun.findFirst.mockResolvedValue(null)
  tx.externalMarketPriceSnapshot.findFirst.mockResolvedValue(null)
  tx.commitment.create.mockResolvedValue({
    id: 'c-1',
    userId: 'user-1',
    user: { id: 'user-1', name: 'Test User', username: null },
    option: null,
  })
  tx.prediction.update.mockResolvedValue({})
  transaction.mockImplementation(async (cb: unknown) => (cb as (t: typeof tx) => unknown)(tx))
})

describe('Commitment.polymarketPrice', () => {
  it('stays null when the forecast has no linked market', async () => {
    predictionFindUnique.mockResolvedValue(prediction() as never)

    const result = await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(result.ok).toBe(true)
    expect(tx.externalMarketPriceSnapshot.findFirst).not.toHaveBeenCalled()
    expect(tx.commitment.create.mock.calls[0][0].data).toMatchObject({ polymarketPrice: null })
  })

  it('stays null when linked but no snapshot exists yet', async () => {
    predictionFindUnique.mockResolvedValue(prediction({ externalMarketId: 'market-1' }) as never)
    tx.externalMarketPriceSnapshot.findFirst.mockResolvedValue(null)

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(tx.externalMarketPriceSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { marketId: 'market-1' }, orderBy: { createdAt: 'desc' } }),
    )
    expect(tx.commitment.create.mock.calls[0][0].data).toMatchObject({ polymarketPrice: null })
  })

  it('snapshots the latest market price, converted to 0-1', async () => {
    predictionFindUnique.mockResolvedValue(prediction({ externalMarketId: 'market-1' }) as never)
    tx.externalMarketPriceSnapshot.findFirst.mockResolvedValue({ probability: 63 })

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(tx.commitment.create.mock.calls[0][0].data).toMatchObject({ polymarketPrice: 0.63 })
  })

  it('applies inverted polarity, matching the display math (100 - raw)', async () => {
    predictionFindUnique.mockResolvedValue(
      prediction({ externalMarketId: 'market-1', externalMarketInverted: true }) as never,
    )
    tx.externalMarketPriceSnapshot.findFirst.mockResolvedValue({ probability: 63 })

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(tx.commitment.create.mock.calls[0][0].data).toMatchObject({ polymarketPrice: 0.37 })
  })

  it('reads inside the commit transaction, not after it', async () => {
    predictionFindUnique.mockResolvedValue(prediction({ externalMarketId: 'market-1' }) as never)
    tx.externalMarketPriceSnapshot.findFirst.mockResolvedValue({ probability: 50 })

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(tx.externalMarketPriceSnapshot.findFirst).toHaveBeenCalledTimes(1)
    expect(tx.commitment.create).toHaveBeenCalledTimes(1)
  })
})
