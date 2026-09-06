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
  prediction: { findUnique: vi.fn(), update: vi.fn() },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findUnique: vi.fn() },
    contextSnapshot: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    commitment: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/services/telegram', () => ({ notifyNewCommitment: vi.fn(), notifyServerError: vi.fn() }))
vi.mock('@/lib/services/notification', () => ({ createNotification: vi.fn() }))
vi.mock('@/lib/services/ai-estimate', () => ({ triggerAiProbabilityEstimate: vi.fn() }))

const { mockLog } = vi.hoisted(() => ({
  mockLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/logger', () => ({ createLogger: () => mockLog }))

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
      externalMarketId: null,
    externalMarketInverted: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  userFindUnique.mockResolvedValue({ id: 'user-1', rs: 100 } as never)
  vi.mocked(prisma.contextSnapshot.findFirst).mockResolvedValue(null)
  commitmentFindUnique.mockResolvedValue(null)
  tx.commitment.findMany.mockResolvedValue([])
  tx.aiEstimateRun.findFirst.mockResolvedValue(null)
  tx.externalMarketPriceSnapshot.findFirst.mockResolvedValue(null)
  tx.prediction.findUnique.mockResolvedValue({ externalMarketId: null, externalMarketInverted: false })
  tx.commitment.create.mockResolvedValue({
    id: 'c-1',
    userId: 'user-1',
    user: { id: 'user-1', name: 'Test User', username: null },
    option: null,
  })
  tx.prediction.update.mockResolvedValue({})
  transaction.mockImplementation(async (cb: unknown) => (cb as (t: typeof tx) => unknown)(tx))
})

/**
 * Sets both the pre-transaction prediction lookup (`prisma.prediction.findUnique`,
 * used for validation/notifications) and the in-transaction re-read
 * (`tx.prediction.findUnique`, the one that actually feeds polymarketPrice) to the
 * same link state. Most tests aren't exercising the race — they want a consistent
 * world — so this keeps them terse; the race test below sets the two differently.
 */
function setLinkedMarket(overrides: Record<string, unknown> = {}) {
  predictionFindUnique.mockResolvedValue(prediction(overrides) as never)
  tx.prediction.findUnique.mockResolvedValue({
    externalMarketId: null,
    externalMarketInverted: false,
    ...overrides,
  })
}

describe('Commitment.polymarketPrice', () => {
  it('stays null when the forecast has no linked market', async () => {
    setLinkedMarket()

    const result = await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(result.ok).toBe(true)
    expect(tx.externalMarketPriceSnapshot.findFirst).not.toHaveBeenCalled()
    expect(tx.commitment.create.mock.calls[0][0].data).toMatchObject({ polymarketPrice: null })
  })

  it('stays null when linked but no snapshot exists yet', async () => {
    setLinkedMarket({ externalMarketId: 'market-1' })
    tx.externalMarketPriceSnapshot.findFirst.mockResolvedValue(null)

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(tx.externalMarketPriceSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { marketId: 'market-1' }, orderBy: { createdAt: 'desc' } }),
    )
    expect(tx.commitment.create.mock.calls[0][0].data).toMatchObject({ polymarketPrice: null })
  })

  it('snapshots the latest market price, converted to 0-1', async () => {
    setLinkedMarket({ externalMarketId: 'market-1' })
    tx.externalMarketPriceSnapshot.findFirst.mockResolvedValue({ probability: 63 })

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(tx.commitment.create.mock.calls[0][0].data).toMatchObject({ polymarketPrice: 0.63 })
  })

  it('applies inverted polarity, matching the display math (100 - raw)', async () => {
    setLinkedMarket({ externalMarketId: 'market-1', externalMarketInverted: true })
    tx.externalMarketPriceSnapshot.findFirst.mockResolvedValue({ probability: 63 })

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(tx.commitment.create.mock.calls[0][0].data).toMatchObject({ polymarketPrice: 0.37 })
  })

  it('reads inside the commit transaction, not after it', async () => {
    setLinkedMarket({ externalMarketId: 'market-1' })
    tx.externalMarketPriceSnapshot.findFirst.mockResolvedValue({ probability: 50 })

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(tx.prediction.findUnique).toHaveBeenCalledTimes(1)
    expect(tx.externalMarketPriceSnapshot.findFirst).toHaveBeenCalledTimes(1)
    expect(tx.commitment.create).toHaveBeenCalledTimes(1)
  })

  it('logs a warning on the eligible-but-missed case (linked market, no snapshot yet) since it is never back-filled', async () => {
    setLinkedMarket({ externalMarketId: 'market-1' })
    tx.externalMarketPriceSnapshot.findFirst.mockResolvedValue(null)

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ predictionId: 'pred-1', marketId: 'market-1' }),
      expect.stringContaining('no price snapshot yet'),
    )
  })

  it('daatan#1702: uses the market linked between the initial read and the transaction, not the stale pre-transaction value', async () => {
    // The prediction had no market linked when createCommitment first read it...
    predictionFindUnique.mockResolvedValue(prediction({ externalMarketId: null }) as never)
    // ...but an admin links one while createCommitment is still doing its
    // pre-transaction dedup check, so by the time the transaction opens and
    // re-reads, the market is live.
    tx.prediction.findUnique.mockResolvedValue({ externalMarketId: 'market-1', externalMarketInverted: false })
    tx.externalMarketPriceSnapshot.findFirst.mockResolvedValue({ probability: 71 })

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(tx.externalMarketPriceSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { marketId: 'market-1' } }),
    )
    expect(tx.commitment.create.mock.calls[0][0].data).toMatchObject({ polymarketPrice: 0.71 })
  })

  it('daatan#1702: does not use a market link that was removed between the initial read and the transaction', async () => {
    predictionFindUnique.mockResolvedValue(prediction({ externalMarketId: 'market-1' }) as never)
    tx.prediction.findUnique.mockResolvedValue({ externalMarketId: null, externalMarketInverted: false })

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(tx.externalMarketPriceSnapshot.findFirst).not.toHaveBeenCalled()
    expect(tx.commitment.create.mock.calls[0][0].data).toMatchObject({ polymarketPrice: null })
  })
})
