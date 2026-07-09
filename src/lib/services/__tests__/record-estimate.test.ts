import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    contextSnapshot: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    predictionTranslation: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/services/telegram', () => ({
  notifyHighConfidence: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import { notifyHighConfidence } from '@/lib/services/telegram'
import { recordEstimate, saveOracleSnapshotOnly, markOracleAttempted, clearSettledLatch } from '@/lib/services/context'

const findUnique = vi.mocked(prisma.prediction.findUnique)
const snapshotCreate = vi.mocked(prisma.contextSnapshot.create)
const update = vi.mocked(prisma.prediction.update)
const deleteTranslations = vi.mocked(prisma.predictionTranslation.deleteMany)
const transaction = vi.mocked(prisma.$transaction)
const notify = vi.mocked(notifyHighConfidence)

function snapshotData(): Record<string, unknown> {
  return (snapshotCreate.mock.calls[0][0] as { data: Record<string, unknown> }).data
}

function updateData(): Record<string, unknown> {
  return (update.mock.calls[0][0] as { data: Record<string, unknown> }).data
}

describe('recordEstimate — the single estimate writer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transaction.mockResolvedValue([{ id: 'snap-1' }] as never)
    findUnique.mockResolvedValue({ confidence: 50, claimText: 'Claim', slug: 'claim' } as never)
  })

  it('stamps origin, kind, and articlesUsed (derived from the oracleSnapshot) on the snapshot', async () => {
    await recordEstimate({
      predictionId: 'pred-1',
      origin: 'news-indexer',
      probability: 62,
      ciLow: 50,
      ciHigh: 74,
      oracleSnapshot: { mean: 62, articlesUsed: 7, sources: [] },
    })
    expect(snapshotData()).toMatchObject({
      origin: 'news-indexer',
      kind: 'evidence',
      externalProbability: 62,
      articlesUsed: 7,
    })
  })

  it('leaves articlesUsed null when the payload has none (LLM fallback / clock)', async () => {
    await recordEstimate({ predictionId: 'pred-1', origin: 'clock', probability: 40, meta: { cause: 'glide' } })
    expect(snapshotData()).toMatchObject({ origin: 'clock', kind: 'clock', articlesUsed: null })
  })

  it('writes needle and band atomically when a probability is present', async () => {
    await recordEstimate({ predictionId: 'pred-1', origin: 'backfill', probability: 91 })
    expect(updateData()).toMatchObject({
      confidence: 91,
      aiCiLow: null,
      aiCiHigh: null,
      awaitingAiResolution: true,
    })
  })

  it('touches neither needle nor band when the run produced no number', async () => {
    await recordEstimate({ predictionId: 'pred-1', origin: 'backfill', probability: null })
    expect(update).not.toHaveBeenCalled()
  })

  it('clears needle, band and the awaiting flag together on abstention', async () => {
    await recordEstimate({ predictionId: 'pred-1', origin: 'analyze', probability: null, insufficientData: true, summary: 'S' })
    expect(updateData()).toMatchObject({
      confidence: null,
      aiCiLow: null,
      aiCiHigh: null,
      awaitingAiResolution: false,
    })
    expect(notify).not.toHaveBeenCalled()
  })

  it('fires the crossing alert for notifying origins only', async () => {
    await recordEstimate({ predictionId: 'pred-1', origin: 'news-indexer', probability: 85 })
    expect(notify).toHaveBeenCalledTimes(1)

    notify.mockClear()
    await recordEstimate({ predictionId: 'pred-2', origin: 'clock', probability: 85 })
    await recordEstimate({ predictionId: 'pred-3', origin: 'creation', probability: 85 })
    expect(notify).not.toHaveBeenCalled()
  })

  it('honors the settled latch only where the origin policy allows it', async () => {
    await recordEstimate({ predictionId: 'pred-1', origin: 'news-indexer', probability: 97, settled: true })
    expect(updateData()).toMatchObject({ settled: true })

    update.mockClear()
    await recordEstimate({ predictionId: 'pred-2', origin: 'clock', probability: 97, settled: true })
    expect(updateData()).not.toHaveProperty('settled')
  })

  it('invalidates detailsText translations only for the analyze origin', async () => {
    await recordEstimate({ predictionId: 'pred-1', origin: 'analyze', probability: 60, summary: 'S' })
    expect(deleteTranslations).toHaveBeenCalledTimes(1)

    deleteTranslations.mockClear()
    await recordEstimate({ predictionId: 'pred-2', origin: 'news-indexer', probability: 60 })
    expect(deleteTranslations).not.toHaveBeenCalled()
  })
})

describe('clearSettledLatch — the only way back from a settled=true latch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears settled and settledAt directly (not via recordEstimate, which can only set true)', async () => {
    await clearSettledLatch('pred-1', 'admin-user-1')
    expect(update).toHaveBeenCalledWith({
      where: { id: 'pred-1' },
      data: { settled: false, settledAt: null },
    })
  })
})

describe('backfill adapters through the funnel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transaction.mockResolvedValue([{ id: 'snap-1' }] as never)
    findUnique.mockResolvedValue({ confidence: 50, claimText: 'Claim', slug: 'claim' } as never)
  })

  it('saveOracleSnapshotOnly puts the estimate on the snapshot (chart + glide anchor can see it)', async () => {
    await saveOracleSnapshotOnly({
      predictionId: 'pred-1',
      oracleSnapshot: { mean: 44, articlesUsed: 5, sources: [] },
      confidence: 44,
      aiCiLow: 30,
      aiCiHigh: 58,
    })
    expect(snapshotData()).toMatchObject({
      origin: 'backfill',
      externalProbability: 44,
      articlesUsed: 5,
    })
  })

  it('markOracleAttempted records a probability-free backfill snapshot and leaves the prediction alone', async () => {
    await markOracleAttempted('pred-1', 'no-articles')
    expect(snapshotData()).toMatchObject({
      origin: 'backfill',
      externalProbability: null,
    })
    expect(update).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
})
