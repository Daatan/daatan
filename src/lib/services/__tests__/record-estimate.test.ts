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
const findFirst = vi.mocked(prisma.contextSnapshot.findFirst)
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
    findFirst.mockResolvedValue(null as never)
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
    findFirst.mockResolvedValue(null as never)
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

/**
 * F17 (daatan#1236): the glide clock's anchor must not reset on a write that carries
 * no new information — a push whose only article was gatekeeper-rejected recomputes
 * an unchanged pool and writes the same probability again. `recordEstimate` tags each
 * evidence-kind write with `materialChange` (did it move enough from the CURRENT
 * anchor to count as new information) and `evidenceAt` (when the evidence behind it
 * was actually published, not when this row was written) — getLatestEvidenceEstimate
 * then excludes non-material rows from anchor selection.
 */
describe('material-change anchor tagging (F17, daatan#1236)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transaction.mockResolvedValue([{ id: 'snap-1' }] as never)
    findUnique.mockResolvedValue({ confidence: 50, claimText: 'Claim', slug: 'claim' } as never)
  })

  it('tags materialChange: true when there is no prior anchor (first-ever evidence write)', async () => {
    findFirst.mockResolvedValue(null as never)
    await recordEstimate({ predictionId: 'pred-1', origin: 'news-indexer', probability: 60, oracleSnapshot: { sources: [] } })
    expect(snapshotData()).toMatchObject({ materialChange: true })
  })

  it('tags materialChange: false on a rejected-article push — same probability as the current anchor, pool unchanged', async () => {
    findFirst.mockResolvedValue({ externalProbability: 60, createdAt: new Date('2026-08-01'), evidenceAt: null } as never)
    await recordEstimate({ predictionId: 'pred-1', origin: 'news-indexer', probability: 60, oracleSnapshot: { sources: [] } })
    expect(snapshotData()).toMatchObject({ materialChange: false })
  })

  it('tags materialChange: true on a genuine update — probability moved by at least MATERIAL_CHANGE_PTS from the anchor', async () => {
    findFirst.mockResolvedValue({ externalProbability: 60, createdAt: new Date('2026-08-01'), evidenceAt: null } as never)
    await recordEstimate({ predictionId: 'pred-1', origin: 'news-indexer', probability: 65, oracleSnapshot: { sources: [] } })
    expect(snapshotData()).toMatchObject({ materialChange: true })
  })

  it('leaves materialChange at its safe default (true) for a clock write — anchor selection never reads clock rows anyway', async () => {
    await recordEstimate({ predictionId: 'pred-1', origin: 'clock', probability: 60, meta: { cause: 'glide' } })
    expect(snapshotData()).toMatchObject({ materialChange: true })
  })

  it('leaves evidenceAt null when no source carries a parseable publish date', async () => {
    findFirst.mockResolvedValue(null as never)
    await recordEstimate({
      predictionId: 'pred-1',
      origin: 'news-indexer',
      probability: 60,
      sources: [{ url: 'https://x.com/a', publishedDate: null }],
      oracleSnapshot: { sources: [] },
    })
    expect(snapshotData()).toMatchObject({ evidenceAt: null })
  })

  it('anchors evidenceAt to the newest oracleSnapshot.sources[].publishedAt, not write time — backfill of old evidence stays old', async () => {
    findFirst.mockResolvedValue(null as never)
    await saveOracleSnapshotOnly({
      predictionId: 'pred-1',
      oracleSnapshot: {
        sources: [
          { url: 'https://a.com/1', publishedAt: '2026-01-15T00:00:00.000Z' },
          { url: 'https://a.com/2', publishedAt: '2026-02-20T00:00:00.000Z' },
        ],
      },
      confidence: 44,
      aiCiLow: 30,
      aiCiHigh: 58,
    })
    expect(snapshotData().evidenceAt).toEqual(new Date('2026-02-20T00:00:00.000Z'))
  })

  it('prefers oracleSnapshot.sources[].publishedAt over the narrower push sources[].publishedDate', async () => {
    findFirst.mockResolvedValue(null as never)
    await recordEstimate({
      predictionId: 'pred-1',
      origin: 'news-indexer',
      probability: 60,
      sources: [{ url: 'https://push.com/a', publishedDate: '2026-06-01T00:00:00.000Z' }],
      oracleSnapshot: { sources: [{ url: 'https://pool.com/b', publishedAt: '2026-05-01T00:00:00.000Z' }] },
    })
    expect(snapshotData().evidenceAt).toEqual(new Date('2026-05-01T00:00:00.000Z'))
  })
})
