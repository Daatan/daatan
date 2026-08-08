import { describe, it, expect, beforeEach, vi } from 'vitest'

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
import { saveNewsIndexerMatch } from '@/lib/services/context'

const sources = [
  { url: 'https://jpost.com/a', title: 'A', source: 'jpost.com', publishedDate: null },
  { url: 'https://ynet.co.il/b', title: 'B', source: 'ynet.co.il', publishedDate: null },
]

const input = () => ({
  predictionId: 'pred-1',
  sources,
  externalProbability: 67,
  ciLow: 40,
  ciHigh: 90,
  oracleSnapshot: { mean: 0.3443, std: 0.43 },
})

/**
 * saveNewsIndexerMatch no longer does its own findFirst-then-compare dedup —
 * that was a check-then-act race under news-indexer's at-least-once webhook
 * delivery (confirmed in prod: 7 near-simultaneous duplicate snapshots, 3
 * with conflicting stance on the same article). Dedup now happens earlier and
 * atomically, per-article, via evidence-pool.ts's claimArticleForExtraction —
 * the route only calls this function once that gate has already confirmed
 * there's something new to record. So this function's only job now is to
 * write, unconditionally, every time it's called.
 *
 * F17 (daatan#1236) adds a `findFirst` read back in — via getLatestEvidenceEstimate,
 * to tag the new row's `materialChange` — but it is NOT a dedup gate: the read's
 * result never skips or blocks the write, only tags it for future anchor selection.
 * The invariant this file actually protects is "the write always happens", not
 * "no read ever happens" — the tests below assert that invariant directly.
 */
describe('saveNewsIndexerMatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.$transaction).mockResolvedValue([{ id: 'snap-1' }] as never)
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      confidence: 67,
      claimText: 'claim',
      slug: 's',
    } as never)
    vi.mocked(prisma.contextSnapshot.findFirst).mockResolvedValue(null as never)
  })

  it('always writes a new snapshot and reports stored: true', async () => {
    const result = await saveNewsIndexerMatch(input())
    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(result).toEqual({ stored: true, contextSnapshotId: 'snap-1' })
  })

  it('writes even when the materiality read (F17) reports the identical probability — no check-then-act skip', async () => {
    // Same externalProbability as `input()` (67): a naive dedup gate would skip this.
    vi.mocked(prisma.contextSnapshot.findFirst).mockResolvedValue({
      externalProbability: 67,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      evidenceAt: null,
    } as never)
    const result = await saveNewsIndexerMatch(input())
    expect(prisma.$transaction).toHaveBeenCalledOnce()
    expect(result).toEqual({ stored: true, contextSnapshotId: 'snap-1' })
  })

  it('writes even when called twice in a row with identical input (caller-level gating, not this function, prevents duplicates)', async () => {
    await saveNewsIndexerMatch(input())
    await saveNewsIndexerMatch(input())
    expect(prisma.$transaction).toHaveBeenCalledTimes(2)
  })
})
