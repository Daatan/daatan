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

const { logError, logInfo } = vi.hoisted(() => ({ logError: vi.fn(), logInfo: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: logInfo, warn: vi.fn(), debug: vi.fn(), error: logError }),
}))

import { prisma } from '@/lib/prisma'
import { notifyHighConfidence } from '@/lib/services/telegram'
import {
  recordEstimate,
  saveOracleSnapshotOnly,
  markOraculAttempted,
  clearSettledLatch,
  dismissAwaitingResolution,
  applyAwaitingDismissal,
  latestEvidenceAssertsSettlement,
} from '@/lib/services/context'

const findUnique = vi.mocked(prisma.prediction.findUnique)
const snapshotCreate = vi.mocked(prisma.contextSnapshot.create)
const findFirst = vi.mocked(prisma.contextSnapshot.findFirst)
const update = vi.mocked(prisma.prediction.update)
const deleteTranslations = vi.mocked(prisma.predictionTranslation.deleteMany)
const transaction = vi.mocked(prisma.$transaction)
const notify = vi.mocked(notifyHighConfidence)

/** A pool that backs a settlement claim under the daatan#1525 bar. `settling` votes
 *  out of `total` rows; defaults are unanimous, which always clears the bar. */
function settledPool(settling = 2, total = settling) {
  return {
    mean: 97,
    sources: Array.from({ length: total }, (_, i) => ({ settled: i < settling })),
  }
}

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

  it('touches neither needle nor band on an abstention either (daatan#1473)', async () => {
    // An abstention is a verdict on THIS run's evidence, not on the number already
    // published — so it takes the same no-op as any run that produced no number. Only a
    // reason listed in CLEARING_ABSTAIN_REASONS clears; see
    // context-abstention-preserves-estimate.test.ts for both branches.
    await recordEstimate({ predictionId: 'pred-1', origin: 'analyze', probability: null, insufficientData: true, summary: 'S' })
    const data = updateData()
    expect(data).not.toHaveProperty('confidence')
    expect(data).not.toHaveProperty('aiCiLow')
    expect(data).not.toHaveProperty('aiCiHigh')
    expect(data).not.toHaveProperty('awaitingAiResolution')
    // the analyze origin still owns the user-facing context, abstention or not
    expect(data).toMatchObject({ detailsText: 'S' })
    expect(notify).not.toHaveBeenCalled()
  })

  it('fires the crossing alert for notifying origins only', async () => {
    await recordEstimate({ predictionId: 'pred-1', origin: 'news-indexer', probability: 85 })
    expect(notify).toHaveBeenCalledTimes(1)

    notify.mockClear()
    await recordEstimate({ predictionId: 'pred-1', origin: 'republish', probability: 85 })
    expect(notify).toHaveBeenCalledTimes(1)

    notify.mockClear()
    await recordEstimate({ predictionId: 'pred-2', origin: 'clock', probability: 85 })
    await recordEstimate({ predictionId: 'pred-3', origin: 'creation', probability: 85 })
    expect(notify).not.toHaveBeenCalled()
  })

  it('honors the settled latch only where the origin policy allows it', async () => {
    await recordEstimate({
      predictionId: 'pred-1',
      origin: 'news-indexer',
      probability: 97,
      settled: true,
      oracleSnapshot: settledPool(),
    })
    expect(updateData()).toMatchObject({ settled: true })

    update.mockClear()
    await recordEstimate({ predictionId: 'pred-2', origin: 'clock', probability: 97, settled: true })
    expect(updateData()).not.toHaveProperty('settled')

    // republish is an operator tool — it must never be able to pin a forecast
    // (daatan#1508); if the pool genuinely settles, the ordinary push path latches it.
    update.mockClear()
    await recordEstimate({ predictionId: 'pred-3', origin: 'republish', probability: 97, settled: true })
    expect(updateData()).not.toHaveProperty('settled')
  })

  // daatan#1498: the invariant this guards is that `settled: true` in the update data
  // and `settled === true` on the returned row are the same fact. Production says
  // otherwise on 1,036 snapshots and nobody can say why, so the writer now says so itself.
  it('reports a settlement latch that was asked for and did not stick', async () => {
    transaction.mockResolvedValue([{ id: 'snap-1' }, { settled: false }] as never)

    await recordEstimate({
      predictionId: 'pred-1',
      origin: 'news-indexer',
      probability: 97,
      settled: true,
      oracleSnapshot: settledPool(),
    })

    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ predictionId: 'pred-1', origin: 'news-indexer', snapshotId: 'snap-1' }),
      expect.stringContaining('settlement latch did not stick'),
    )
  })

  it('stays quiet when the latch sticks, and when no latch was asked for', async () => {
    transaction.mockResolvedValue([{ id: 'snap-1' }, { settled: true }] as never)
    await recordEstimate({
      predictionId: 'pred-1',
      origin: 'news-indexer',
      probability: 97,
      settled: true,
      oracleSnapshot: settledPool(),
    })

    // an origin that cannot settle never asked, so a false row is not a discrepancy
    transaction.mockResolvedValue([{ id: 'snap-2' }, { settled: false }] as never)
    await recordEstimate({ predictionId: 'pred-2', origin: 'clock', probability: 97, settled: true })

    expect(logError).not.toHaveBeenCalled()
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
    findUnique.mockResolvedValue({ confidence: 97 } as never)
  })

  it('clears settled and settledAt directly (not via recordEstimate, which can only set true)', async () => {
    const now = new Date('2026-08-20T10:30:00.000Z')
    await clearSettledLatch('pred-1', 'admin-user-1', now)
    expect(update).toHaveBeenCalledWith({
      where: { id: 'pred-1' },
      data: {
        settled: false,
        settledAt: null,
        settledClearedAt: now,
        settledClearedBy: 'admin-user-1',
        awaitingAiResolution: false,
        settledDriftAlertAt: null,
        unlatchedPinAlertAt: null,
        awaitingDismissedAt: now,
        awaitingDismissedConfidence: 97,
      },
    })
  })

  // daatan#1655: the "Awaiting Resolution" feed reads awaitingAiResolution, which only
  // recordEstimate recomputes — so a clear that left it alone changed nothing visible.
  it('drops the forecast out of Awaiting Resolution and re-arms the clock alerts', async () => {
    await clearSettledLatch('pred-1', 'admin-user-1')
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.awaitingAiResolution).toBe(false)
    expect(data.settledDriftAlertAt).toBeNull()
    expect(data.unlatchedPinAlertAt).toBeNull()
  })

  // Without this the clear erased its own tracks — a cleared row and a row that never
  // latched were byte-identical, which is what made #1498 unfalsifiable from the data.
  it('records who cleared it and when, so a cleared latch is distinguishable from one that never fired', async () => {
    await clearSettledLatch('pred-1', 'admin-user-1')
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(data.settledClearedBy).toBe('admin-user-1')
    expect(data.settledClearedAt).toBeInstanceOf(Date)
  })
})

describe('Awaiting Resolution dismissal (daatan#1659)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transaction.mockResolvedValue([{ id: 'snap-1' }] as never)
    findFirst.mockResolvedValue(null as never)
  })

  it('dismissAwaitingResolution clears the flag + clock stamps and records the number the human saw', async () => {
    findUnique.mockResolvedValue({ confidence: 95 } as never)
    const now = new Date('2026-08-29T17:00:00.000Z')
    await dismissAwaitingResolution('pred-1', 'admin-user-1', now)
    expect(update).toHaveBeenCalledWith({
      where: { id: 'pred-1' },
      data: {
        awaitingAiResolution: false,
        settledDriftAlertAt: null,
        unlatchedPinAlertAt: null,
        awaitingDismissedAt: now,
        awaitingDismissedConfidence: 95,
      },
    })
  })

  it('applyAwaitingDismissal: holds while the estimate stays within the sticky band', () => {
    const d = { awaitingDismissedAt: new Date(), awaitingDismissedConfidence: 95 }
    expect(applyAwaitingDismissal(true, 97, d)).toEqual({ awaitingAiResolution: false, keepDismissal: true })
    expect(applyAwaitingDismissal(true, 90, d)).toEqual({ awaitingAiResolution: false, keepDismissal: true })
  })

  it('applyAwaitingDismissal: forgotten once the estimate moves more than the band, either way', () => {
    const d = { awaitingDismissedAt: new Date(), awaitingDismissedConfidence: 95 }
    expect(applyAwaitingDismissal(true, 89, d)).toEqual({ awaitingAiResolution: true, keepDismissal: false })
    expect(applyAwaitingDismissal(false, 60, d)).toEqual({ awaitingAiResolution: false, keepDismissal: false })
  })

  it('applyAwaitingDismissal: no dismissal → the computed flag passes through', () => {
    expect(applyAwaitingDismissal(true, 97, null)).toEqual({ awaitingAiResolution: true, keepDismissal: false })
    expect(applyAwaitingDismissal(true, 97, { awaitingDismissedAt: null, awaitingDismissedConfidence: null }))
      .toEqual({ awaitingAiResolution: true, keepDismissal: false })
  })

  it('recordEstimate keeps a dismissed forecast out of the queue on a same-number requote', async () => {
    findUnique.mockResolvedValue({
      confidence: 95, claimText: 'Claim', slug: 'claim',
      awaitingDismissedAt: new Date('2026-08-29T17:00:00.000Z'), awaitingDismissedConfidence: 95,
    } as never)
    await recordEstimate({
      predictionId: 'pred-1', origin: 'clock', probability: 96,
      oracleSnapshot: { mean: 96, sources: [] },
    })
    const data = updateData()
    expect(data.awaitingAiResolution).toBe(false)
    expect(data).not.toHaveProperty('awaitingDismissedAt')
  })

  it('recordEstimate forgets the dismissal and re-flags once the estimate moves past the band', async () => {
    findUnique.mockResolvedValue({
      confidence: 95, claimText: 'Claim', slug: 'claim',
      awaitingDismissedAt: new Date('2026-08-29T17:00:00.000Z'), awaitingDismissedConfidence: 88,
    } as never)
    await recordEstimate({
      predictionId: 'pred-1', origin: 'news-indexer', probability: 95, ciLow: 90, ciHigh: 99,
      oracleSnapshot: { mean: 95, sources: [] },
    })
    const data = updateData()
    expect(data.awaitingAiResolution).toBe(true)
    expect(data.awaitingDismissedAt).toBeNull()
    expect(data.awaitingDismissedConfidence).toBeNull()
  })

  it('recordEstimate does not read the dismissal when the write would not flag anyway', async () => {
    findUnique.mockResolvedValue({ confidence: 50, claimText: 'Claim', slug: 'claim' } as never)
    await recordEstimate({
      predictionId: 'pred-1', origin: 'clock', probability: 55,
      oracleSnapshot: { mean: 55, sources: [] },
    })
    expect(updateData().awaitingAiResolution).toBe(false)
    expect(findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ select: { awaitingDismissedAt: true, awaitingDismissedConfidence: true } }),
    )
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

  it('markOraculAttempted records a probability-free backfill snapshot and leaves the prediction alone', async () => {
    await markOraculAttempted('pred-1', 'no-articles')
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

describe('latestEvidenceAssertsSettlement — is the pin the thing we are publishing right now?', () => {
  const ASSERTED_AT = new Date('2026-08-15T22:24:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Two queries, one question: the newest evidence snapshot and the newest one that
  // asserts settlement have to be the SAME row. `some: {settled:true}` alone would
  // match a forecast whose pin was superseded days ago by ordinary evidence.
  it('reports the assertion when the newest evidence snapshot is the asserting one', async () => {
    findFirst
      .mockResolvedValueOnce({ id: 'snap-9', createdAt: ASSERTED_AT, externalProbability: 97 } as never)
      .mockResolvedValueOnce({ id: 'snap-9' } as never)

    await expect(latestEvidenceAssertsSettlement('pred-1')).resolves.toEqual({
      assertedAt: ASSERTED_AT,
      probability: 97,
    })
  })

  it('reports nothing once newer evidence has superseded the assertion', async () => {
    findFirst
      .mockResolvedValueOnce({ id: 'snap-12', createdAt: new Date(), externalProbability: 62 } as never)
      .mockResolvedValueOnce({ id: 'snap-9' } as never)

    await expect(latestEvidenceAssertsSettlement('pred-1')).resolves.toBeNull()
  })

  it('reports nothing when no snapshot ever asserted settlement', async () => {
    findFirst
      .mockResolvedValueOnce({ id: 'snap-12', createdAt: new Date(), externalProbability: 62 } as never)
      .mockResolvedValueOnce(null as never)

    await expect(latestEvidenceAssertsSettlement('pred-1')).resolves.toBeNull()
  })

  it('ignores clock snapshots and abstentions on both sides of the comparison', async () => {
    findFirst
      .mockResolvedValueOnce({ id: 'snap-9', createdAt: ASSERTED_AT, externalProbability: 97 } as never)
      .mockResolvedValueOnce({ id: 'snap-9' } as never)

    await latestEvidenceAssertsSettlement('pred-1')

    for (const call of findFirst.mock.calls) {
      const where = (call[0] as { where: Record<string, unknown> }).where
      expect(where).toMatchObject({ insufficientData: false, kind: { not: 'clock' } })
    }
  })
})

describe('the settlement bar — a pin must be backed by its pool (#1525)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    transaction.mockResolvedValue([{ id: 'snap-1' }, { settled: true }] as never)
    findUnique.mockResolvedValue({ confidence: 50, claimText: 'Claim', slug: 'claim' } as never)
    findFirst.mockResolvedValue(null as never)
  })

  const pin = (oracleSnapshot: unknown) =>
    recordEstimate({
      predictionId: 'pred-1',
      origin: 'news-indexer',
      probability: 97,
      settled: true,
      oracleSnapshot: oracleSnapshot as never,
    })

  it('latches a unanimous pool, however small — 2 of 2 is the strongest evidence there is', async () => {
    await pin(settledPool(2, 2))
    expect(updateData()).toMatchObject({ settled: true })
  })

  it('latches 3 of 5', async () => {
    await pin(settledPool(3, 5))
    expect(updateData()).toMatchObject({ settled: true })
  })

  // The case that motivated the change: raising the bare count would have rejected
  // 2-of-2 above while still admitting these, because count tracks pool size.
  it('refuses 2 of 97 and 3 of 123 — a settlement claim 2% of the pool supports', async () => {
    await pin(settledPool(2, 97))
    expect(updateData()).not.toHaveProperty('settled')

    update.mockClear()
    await pin(settledPool(3, 123))
    expect(updateData()).not.toHaveProperty('settled')
  })

  it('refuses 1 of 1 — unanimous, but the count floor is what stops a share test there', async () => {
    await pin(settledPool(1, 1))
    expect(updateData()).not.toHaveProperty('settled')
  })

  it('fails closed when the pin arrives without a pool at all', async () => {
    await pin({})
    expect(updateData()).not.toHaveProperty('settled')

    update.mockClear()
    await pin(undefined)
    expect(updateData()).not.toHaveProperty('settled')
  })

  it('keeps the estimate a rejected pin came with — only the latch is withheld', async () => {
    await pin(settledPool(2, 97))
    expect(updateData()).toMatchObject({ confidence: 97 })
    expect(snapshotData()).toMatchObject({ externalProbability: 97 })
  })

  it('holds a rejected pin out of the Awaiting Resolution band as well', async () => {
    await pin(settledPool(2, 97))
    // 97 clears AWAITING_AI_RESOLUTION_HIGH on level, but a pin is admitted on its
    // backing or not at all (#1248) — its confidence is a constant, not a level.
    expect(updateData()).toMatchObject({ awaitingAiResolution: false })
  })

  it('sends no settled-line alert for a rejected pin', async () => {
    findUnique.mockResolvedValue({ confidence: 50, claimText: 'Claim', slug: 'claim' } as never)
    await pin(settledPool(2, 97))
    expect(notify).not.toHaveBeenCalled()
  })

  it('logs the rejection with both counts, so the rate is visible immediately', async () => {
    await pin(settledPool(2, 97))
    expect(logInfo).toHaveBeenCalledWith(
      expect.objectContaining({ predictionId: 'pred-1', settling: 2, total: 97, backed: false }),
      expect.stringContaining('settlement pin rejected'),
    )
  })

  it('says nothing when the pool does back the claim', async () => {
    await pin(settledPool(4, 4))
    expect(logInfo).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('settlement pin rejected'),
    )
  })
})
