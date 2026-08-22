/**
 * daatan#1563 — retro's `/pool/aggregate` emits `evidence_mass`/`n_eff`/`age_adjusted_mass`
 * (retro#458 Phase 2 diagnostics) but daatan's TS interfaces didn't declare them, so they
 * were silently dropped before ever reaching `recordEstimate`. This covers the `poolMeta`
 * merge added to `recordEstimate`: written under `meta.pool` alongside the pre-existing
 * `meta.abstain` block, and left out entirely when the run carried no pool diagnostics
 * (the single-run / pre-#1563 pool-aggregate shape).
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
import { recordEstimate } from '@/lib/services/context'

const create = vi.mocked(prisma.contextSnapshot.create)

function snapshotData(): Record<string, unknown> {
  return (create.mock.calls[0][0] as { data: Record<string, unknown> }).data
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockResolvedValue([{ id: 'snap-1' }] as never)
  vi.mocked(prisma.contextSnapshot.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
    confidence: 50,
    claimText: 'Some claim',
    slug: 'some-claim',
  } as never)
})

const baseInput = {
  predictionId: 'pred-1',
  origin: 'news-indexer' as const,
  probability: 71,
  ciLow: 61,
  ciHigh: 81,
}

describe('recordEstimate: pool diagnostics meta (daatan#1563)', () => {
  it('persists evidenceMass/nEff/ageAdjustedMass under meta.pool', async () => {
    await recordEstimate({ ...baseInput, evidenceMass: 3.42, nEff: 2.1, ageAdjustedMass: 3.9 })
    expect(snapshotData().meta).toEqual({
      pool: { evidenceMass: 3.42, nEff: 2.1, ageAdjustedMass: 3.9 },
    })
  })

  it('persists nulls rather than dropping the key when only some fields are present', async () => {
    await recordEstimate({ ...baseInput, evidenceMass: 3.42, nEff: null, ageAdjustedMass: undefined })
    expect(snapshotData().meta).toEqual({
      pool: { evidenceMass: 3.42, nEff: null, ageAdjustedMass: null },
    })
  })

  it('leaves meta undefined when no pool diagnostics and no abstention are present', async () => {
    await recordEstimate(baseInput)
    expect(snapshotData().meta).toBeUndefined()
  })

  it('merges pool diagnostics alongside abstain metadata on the same write', async () => {
    await recordEstimate({
      predictionId: 'pred-1',
      origin: 'news-indexer',
      probability: null,
      insufficientData: true,
      insufficientReason: 'all_articles_off_topic',
      poolSize: 12,
      evidenceMass: 1.5,
      nEff: 0.9,
      ageAdjustedMass: 1.4,
    })
    expect(snapshotData().meta).toEqual({
      abstain: { reason: 'all_articles_off_topic', poolSize: 12 },
      pool: { evidenceMass: 1.5, nEff: 0.9, ageAdjustedMass: 1.4 },
    })
  })

  it('an explicit meta input overrides the computed pool/abstain meta entirely', async () => {
    await recordEstimate({
      ...baseInput,
      evidenceMass: 3.42,
      nEff: 2.1,
      ageAdjustedMass: 3.9,
      meta: { custom: 'value' },
    })
    expect(snapshotData().meta).toEqual({ custom: 'value' })
  })
})
