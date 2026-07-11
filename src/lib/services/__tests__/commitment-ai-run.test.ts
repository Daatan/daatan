import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Guards `Commitment.aiRunIdAtCommit` — the AI panel's matched-time Brier anchor
 * (docs/LASSO.md §7).
 *
 * This lives in the UNIT suite on purpose. The equivalent integration test exercises
 * the real FK and migration, but CI runs only `npm test`, whose vitest config excludes
 * every `.integration.test.ts` file — so without this file nothing in CI would catch a
 * regression. And a regression here is unrecoverable: the run current at commit time
 * cannot be reconstructed after the fact.
 */

const tx = {
  commitment: { findMany: vi.fn(), create: vi.fn() },
  aiEstimateRun: { findFirst: vi.fn() },
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

const PREDICTION = {
  id: 'pred-1',
  status: 'ACTIVE',
  authorId: 'author-1',
  outcomeType: 'BINARY',
  claimText: 'A claim',
  slug: 'a-claim',
  lockedAt: null,
  settled: false,
  confidence: 60,
  resolveByDatetime: new Date('2030-01-01'),
  claimDeadline: null,
  options: [],
  contextSnapshots: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  predictionFindUnique.mockResolvedValue(PREDICTION as never)
  userFindUnique.mockResolvedValue({ id: 'user-1', rs: 100 } as never)
  commitmentFindUnique.mockResolvedValue(null)
  tx.commitment.findMany.mockResolvedValue([])
  tx.commitment.create.mockResolvedValue({
    id: 'c-1',
    userId: 'user-1',
    aiProbabilityAtCommit: 0.6,
    user: { id: 'user-1', name: 'Test User', username: null },
    option: null,
  })
  tx.prediction.update.mockResolvedValue({})
  transaction.mockImplementation(async (cb: unknown) => (cb as (t: typeof tx) => unknown)(tx))
})

describe('Commitment.aiRunIdAtCommit', () => {
  it('pins the most recent AI-panel run at commit time', async () => {
    tx.aiEstimateRun.findFirst.mockResolvedValue({ id: 'run-current' })

    const result = await createCommitment('user-1', 'pred-1', { confidence: 70 })
    expect(result.ok).toBe(true)

    expect(tx.aiEstimateRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { predictionId: 'pred-1' },
        orderBy: { createdAt: 'desc' },
      }),
    )
    expect(tx.commitment.create.mock.calls[0][0].data).toMatchObject({
      aiRunIdAtCommit: 'run-current',
    })
  })

  it('writes null when the panel has never run on this forecast', async () => {
    tx.aiEstimateRun.findFirst.mockResolvedValue(null)

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    expect(tx.commitment.create.mock.calls[0][0].data).toMatchObject({
      aiRunIdAtCommit: null,
    })
  })

  it('captures the run inside the commit transaction, not after it', async () => {
    tx.aiEstimateRun.findFirst.mockResolvedValue({ id: 'run-current' })

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    // Both reads must happen against the transaction client. A read outside the tx
    // could observe a run written between the snapshot and the commitment insert.
    expect(tx.aiEstimateRun.findFirst).toHaveBeenCalledTimes(1)
    expect(tx.commitment.create).toHaveBeenCalledTimes(1)
  })

  it('leaves the Oracle scalar snapshot untouched — the two are independent', async () => {
    tx.aiEstimateRun.findFirst.mockResolvedValue({ id: 'run-current' })

    await createCommitment('user-1', 'pred-1', { confidence: 70 })

    const data = tx.commitment.create.mock.calls[0][0].data
    // The Oracle IS one number, so it stays a scalar. The panel is many, so it is a FK.
    expect(data.aiProbabilityAtCommit).toBe(0.6)
    expect(data.aiRunIdAtCommit).toBe('run-current')
  })
})
