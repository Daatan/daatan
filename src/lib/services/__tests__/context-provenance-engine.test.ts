/**
 * daatan#1617 — retro's `/forecast` and `/pool/aggregate` responses carry a
 * `Provenance` block (`engine`, `schema_version`, `method`, ...) but daatan's
 * `ContextSnapshot` had no column to record which engine (v1/v2) produced a
 * stored row — a precondition for the paired v1/v2 scoring plan. This covers
 * the plumbing added to `recordEstimate`: `engine`/`schemaVersion` land as real
 * top-level columns on the create() call (unlike `evidenceMass`/`nEff`, which
 * live under `meta.pool` — see daatan#1563 / context-pool-meta.test.ts), and an
 * omitted `engine` is passed through as `undefined` so the DB default ('v1')
 * stays in force rather than being overwritten with an explicit NULL.
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

describe('recordEstimate: engine/schemaVersion provenance (daatan#1617)', () => {
  it('persists engine/schemaVersion as top-level columns, not under meta', async () => {
    await recordEstimate({ ...baseInput, engine: 'v1', schemaVersion: '1.0' })
    const data = snapshotData()
    expect(data.engine).toBe('v1')
    expect(data.schemaVersion).toBe('1.0')
    expect(data.meta).toBeUndefined()
  })

  it('passes undefined (not null) when omitted, leaving the DB default in force', async () => {
    await recordEstimate(baseInput)
    const data = snapshotData()
    expect(data.engine).toBeUndefined()
    expect(data.schemaVersion).toBeUndefined()
  })

  it('threads a v2 value through unchanged — plumbing only, no v2 caller exists yet', async () => {
    await recordEstimate({ ...baseInput, engine: 'v2', schemaVersion: '1.0' })
    expect(snapshotData().engine).toBe('v2')
  })
})
