/**
 * daatan#1473 — an abstention must not wipe a published estimate.
 *
 * Prod case `cmrxmuctp07hc01qo4nk5giwm` (US–Saudi nuclear cooperation): a 115-article pool
 * aggregating to 97, with the settlement verifier agreeing it settles. One `analyze` run at
 * 2026-08-17 14:49 returned `insufficient_data=true`, the write layer nulled
 * `confidence`/`aiCiLow`/`aiCiHigh`, and the forecast displayed no estimate at all for ~23 h
 * — no self-heal until some later pool write happened to touch the row.
 *
 * The fix is a discrimination, not a switch: `recordEstimate` now decides from the abstention's
 * REASON rather than the bare `insufficientData` boolean. Nothing retro emits today condemns a
 * prior estimate, so every live abstention preserves; `CLEARING_ABSTAIN_REASONS` is the declared
 * hook for one that would (a pool-staleness abstention, retro#416).
 */
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
    $transaction: vi.fn().mockResolvedValue([{ id: 'snap-1' }]),
  },
}))

vi.mock('@/lib/services/telegram', () => ({
  notifyHighConfidence: vi.fn(),
}))

import { prisma } from '@/lib/prisma'
import {
  CLEARING_ABSTAIN_REASONS,
  saveContextUpdate,
  saveNewsIndexerMatch,
  saveOracleSnapshotOnly,
} from '@/lib/services/context'

const update = vi.mocked(prisma.prediction.update)
const create = vi.mocked(prisma.contextSnapshot.create)

/** The Prediction fields this write would change, or null when it never touched the row. */
function updatedData(): Record<string, unknown> | null {
  if (update.mock.calls.length === 0) return null
  return (update.mock.calls[0][0] as { data: Record<string, unknown> }).data
}

function snapshotData(): Record<string, unknown> {
  return (create.mock.calls[0][0] as { data: Record<string, unknown> }).data
}

const abstainingPush = (reason: string | null, poolSize: number | null = 115) => ({
  predictionId: 'pred-1',
  sources: [],
  externalProbability: null,
  ciLow: null,
  ciHigh: null,
  insufficientData: true,
  insufficientReason: reason,
  poolSize,
  oracleSnapshot: { sources: [], insufficient: true, reason },
})

const abstainingAnalyze = (reason: string | null) => ({
  predictionId: 'pred-1',
  summary: 'summary',
  sources: [],
  externalProbability: null,
  externalReasoning: 'Insufficient evidence — the gathered coverage does not bear on this claim',
  oracleSnapshot: null,
  confidence: null,
  aiCiLow: null,
  aiCiHigh: null,
  insufficientData: true,
  insufficientReason: reason,
  poolSize: 115,
  now: new Date('2026-08-17T14:49:00Z'),
})

const ESTIMATE_FIELDS = ['confidence', 'aiCiLow', 'aiCiHigh', 'awaitingAiResolution']

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockResolvedValue([{ id: 'snap-1' }] as never)
  vi.mocked(prisma.contextSnapshot.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
    confidence: 97,
    claimText: 'The US and Saudi Arabia will sign a nuclear cooperation agreement',
    slug: 'us-saudi-nuclear',
  } as never)
})

// ── the published estimate survives every reason retro emits today ────────────────────

describe('an ordinary abstention leaves the published estimate standing', () => {
  it.each([
    ['all_articles_off_topic'],
    ['no_usable_weight'],
    ['oracle_abstain'],
  ])('news-indexer push, reason %s', async (reason) => {
    await saveNewsIndexerMatch(abstainingPush(reason))
    expect(updatedData()).toBeNull()
  })

  it('a null reason preserves too — an unexplained abstention is the weakest case of all', async () => {
    await saveNewsIndexerMatch(abstainingPush(null))
    expect(updatedData()).toBeNull()
  })

  it('an unrecognised future reason preserves — the fail-safe direction', async () => {
    await saveNewsIndexerMatch(abstainingPush('some_reason_that_ships_later'))
    expect(updatedData()).toBeNull()
  })

  it('the backfill path preserves as well — one writer, so no second site to mirror into', async () => {
    await saveOracleSnapshotOnly({
      predictionId: 'pred-1',
      oracleSnapshot: { sources: [], insufficient: true, reason: 'all_articles_off_topic' },
      confidence: null,
      aiCiLow: null,
      aiCiHigh: null,
      insufficientData: true,
      insufficientReason: 'all_articles_off_topic',
      poolSize: 115,
    })
    expect(updatedData()).toBeNull()
  })

  it('the analyze path — the one that caused #1473 — writes its summary but no estimate fields', async () => {
    // `analyze` owns the user-facing context, so its Prediction update is not empty; what
    // matters is that not one of the four estimate fields is in it.
    await saveContextUpdate(abstainingAnalyze('all_articles_off_topic'))
    const data = updatedData()
    expect(data).not.toBeNull()
    expect(Object.keys(data!)).toEqual(['detailsText', 'contextUpdatedAt'])
    for (const field of ESTIMATE_FIELDS) expect(data).not.toHaveProperty(field)
  })
})

// ── the abstention is still recorded, and now says why ────────────────────────────────

describe('the abstention is still fully recorded', () => {
  it('flags the snapshot, so the UI still renders "Insufficient evidence"', async () => {
    await saveNewsIndexerMatch(abstainingPush('all_articles_off_topic'))
    expect(snapshotData().insufficientData).toBe(true)
    expect(snapshotData().externalProbability).toBeNull()
  })

  it('persists the reason and pool size, which were previously only logged', async () => {
    await saveNewsIndexerMatch(abstainingPush('all_articles_off_topic', 115))
    expect(snapshotData().meta).toEqual({
      abstain: { reason: 'all_articles_off_topic', poolSize: 115 },
    })
  })

  it('persists nulls rather than nothing when the path had neither', async () => {
    await saveNewsIndexerMatch(abstainingPush(null, null))
    expect(snapshotData().meta).toEqual({ abstain: { reason: null, poolSize: null } })
  })

  it('carries the analyze abstention too — the path that could not be diagnosed at all', async () => {
    await saveContextUpdate(abstainingAnalyze('all_articles_off_topic'))
    expect(snapshotData().meta).toEqual({
      abstain: { reason: 'all_articles_off_topic', poolSize: 115 },
    })
  })

  it('leaves meta alone on a non-abstaining write', async () => {
    await saveNewsIndexerMatch({
      predictionId: 'pred-1',
      sources: [],
      externalProbability: 71,
      ciLow: 61,
      ciHigh: 81,
      oracleSnapshot: {},
    })
    expect(snapshotData().meta).toBeUndefined()
    expect(updatedData()).toMatchObject({ confidence: 71, aiCiLow: 61, aiCiHigh: 81 })
  })
})

// ── the clearing branch: policy, and proof it still works when a reason lands ─────────

describe('CLEARING_ABSTAIN_REASONS', () => {
  it('is empty — no abstention retro emits today condemns a prior estimate', () => {
    // Not a tidy-up: emptying this set IS the #1473 fix. Adding a reason means asserting
    // that the reason is a verdict on the published number, not on the run's own evidence.
    expect([...CLEARING_ABSTAIN_REASONS]).toEqual([])
  })

  it('clears needle, band and the resolution flag together once a reason is listed', async () => {
    CLEARING_ABSTAIN_REASONS.add('stale_pool')
    try {
      await saveNewsIndexerMatch(abstainingPush('stale_pool'))
      expect(updatedData()).toEqual({
        confidence: null,
        aiCiLow: null,
        aiCiHigh: null,
        awaitingAiResolution: false,
      })
    } finally {
      CLEARING_ABSTAIN_REASONS.delete('stale_pool')
    }
  })

  it('a listed reason clears on the analyze path too', async () => {
    CLEARING_ABSTAIN_REASONS.add('stale_pool')
    try {
      await saveContextUpdate(abstainingAnalyze('stale_pool'))
      expect(updatedData()).toMatchObject({ confidence: null, aiCiLow: null, aiCiHigh: null })
    } finally {
      CLEARING_ABSTAIN_REASONS.delete('stale_pool')
    }
  })
})
