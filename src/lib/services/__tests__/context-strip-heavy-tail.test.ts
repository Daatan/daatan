import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findFirst: vi.fn() },
    contextSnapshot: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/services/telegram', () => ({ notifyHighConfidence: vi.fn() }))

import { prisma } from '@/lib/prisma'
import { getContextTimeline, listContextSnapshots } from '@/lib/services/context'

const findFirst = vi.mocked(prisma.prediction.findFirst)
const findMany = vi.mocked(prisma.contextSnapshot.findMany)

/** N newest-first snapshots, each with heavy blobs + the thin fields the chart reads. */
function makeSnapshots(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `snap-${i}`,
    predictionId: 'pred-1',
    summary: `summary ${i}`,
    sources: [{ url: `https://ex.com/${i}`, title: `t${i}` }],
    externalProbability: 50 + i,
    externalReasoning: null,
    oracleSnapshot: { mean: 0.5 },
    insufficientData: false,
    createdAt: new Date(2026, 0, 1, 0, n - i),
    kind: 'evidence',
  }))
}

describe('stripHeavyTail on the timeline reads', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps heavy fields for the 25 most-recent snapshots and strips older ones', async () => {
    findMany.mockResolvedValue(makeSnapshots(30) as never)
    const out = await listContextSnapshots('pred-1')

    // Recent (index < 25): full detail retained.
    expect(out[24].sources).toEqual([{ url: 'https://ex.com/24', title: 't24' }])
    expect(out[24].oracleSnapshot).toEqual({ mean: 0.5 })
    // Tail (index >= 25): heavy blobs dropped.
    expect(out[25].sources).toEqual([])
    expect(out[25].oracleSnapshot).toBeNull()
    expect(out[29].sources).toEqual([])
  })

  it('preserves the chart fields (createdAt + externalProbability) on every snapshot', async () => {
    findMany.mockResolvedValue(makeSnapshots(30) as never)
    const out = await listContextSnapshots('pred-1')
    // The probability chart reads these from all points, including the stripped tail.
    expect(out.every(s => typeof s.externalProbability === 'number')).toBe(true)
    expect(out.every(s => s.createdAt != null)).toBe(true)
    expect(out[29].externalProbability).toBe(79)
  })

  it('does not strip a timeline that is under the limit', async () => {
    findMany.mockResolvedValue(makeSnapshots(4) as never)
    const out = await listContextSnapshots('pred-1')
    expect(out.every(s => Array.isArray(s.sources) && s.sources.length === 1)).toBe(true)
    expect(out.every(s => s.oracleSnapshot != null)).toBe(true)
  })

  it('getContextTimeline strips the tail inside the prediction payload', async () => {
    findFirst.mockResolvedValue({
      id: 'pred-1',
      detailsText: 'x',
      contextUpdatedAt: new Date(),
      contextSnapshots: makeSnapshots(30),
    } as never)
    const out = await getContextTimeline('pred-1')
    expect(out?.contextSnapshots[0].sources).not.toEqual([])   // recent kept
    expect(out?.contextSnapshots[25].sources).toEqual([])      // tail stripped
    expect(out?.contextSnapshots[25].externalProbability).toBe(75)  // chart field kept
  })

  it('getContextTimeline returns null when the prediction is missing', async () => {
    findFirst.mockResolvedValue(null)
    expect(await getContextTimeline('missing')).toBeNull()
  })
})
