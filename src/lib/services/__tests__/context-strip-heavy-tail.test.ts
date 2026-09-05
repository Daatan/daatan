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

const HEAVY_LIMIT = 25

/** N newest-first snapshots, each with heavy blobs + the thin fields the chart reads. */
function makeSnapshots(n: number, from = 0) {
  return Array.from({ length: n }, (_, j) => {
    const i = from + j
    return {
      id: `snap-${i}`,
      predictionId: 'pred-1',
      summary: `summary ${i}`,
      sources: [{ url: `https://ex.com/${i}`, title: `t${i}` }],
      externalProbability: 50 + i,
      externalReasoning: null,
      oracleSnapshot: { mean: 0.5 },
      insufficientData: false,
      createdAt: new Date(2026, 0, 1, 0, 100 - i),
      kind: 'evidence',
    }
  })
}

/** What the tail query hands back: the same rows without the two JSON columns. */
function light(rows: ReturnType<typeof makeSnapshots>) {
  return rows.map(({ sources: _s, oracleSnapshot: _o, ...rest }) => rest)
}

/**
 * Play the two-statement read against a fixture history: the head call returns the first
 * `HEAVY_LIMIT` rows in full, the tail call the rest without their blobs — exactly what
 * Postgres returns when the tail query never names `sources` / `oracle_snapshot`.
 */
function mockHistory(total: number) {
  const all = makeSnapshots(total)
  findMany.mockReset()
  findMany.mockResolvedValueOnce(all.slice(0, HEAVY_LIMIT) as never)
  findMany.mockResolvedValueOnce(light(all.slice(HEAVY_LIMIT)) as never)
  return all
}

describe('timeline reads: heavy head, light tail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps heavy fields for the 25 most-recent snapshots and strips older ones', async () => {
    mockHistory(30)
    const out = await listContextSnapshots('pred-1')

    expect(out).toHaveLength(30)
    // Recent (index < 25): full detail retained.
    expect(out[24].sources).toEqual([{ url: 'https://ex.com/24', title: 't24' }])
    expect(out[24].oracleSnapshot).toEqual({ mean: 0.5 })
    // Tail (index >= 25): heavy blobs dropped.
    expect(out[25].sources).toEqual([])
    expect(out[25].oracleSnapshot).toBeNull()
    expect(out[29].sources).toEqual([])
  })

  it('preserves the chart fields (createdAt + externalProbability) on every snapshot', async () => {
    mockHistory(30)
    const out = await listContextSnapshots('pred-1')
    // The probability chart reads these from all points, including the stripped tail.
    expect(out.every(s => typeof s.externalProbability === 'number')).toBe(true)
    expect(out.every(s => s.createdAt != null)).toBe(true)
    expect(out[29].externalProbability).toBe(79)
  })

  it('never asks Postgres for the blobs of the tail, and keys the tail on the head', async () => {
    mockHistory(30)
    await listContextSnapshots('pred-1')

    expect(findMany).toHaveBeenCalledTimes(2)
    const [head, tail] = findMany.mock.calls.map((c) => c[0]!)
    expect(head).toMatchObject({ take: HEAVY_LIMIT, where: { predictionId: 'pred-1' } })
    expect(head.select).toBeUndefined()
    // The tail selects every scalar column and neither JSON column: the read cost was
    // the detoast of `oracle_snapshot`, which only a query that never names it avoids.
    const select = tail.select as Record<string, boolean>
    expect(select.sources).toBeUndefined()
    expect(select.oracleSnapshot).toBeUndefined()
    expect(select).toMatchObject({ id: true, createdAt: true, externalProbability: true, kind: true })
    // Cursor on the head's last row, not `skip: 25`: an insert between the two statements
    // must not duplicate or drop the row at the boundary.
    expect(tail).toMatchObject({ cursor: { id: 'snap-24' }, skip: 1 })
    expect(tail.orderBy).toEqual(head.orderBy)
  })

  it('reads once for a timeline under the limit and strips nothing', async () => {
    findMany.mockReset()
    findMany.mockResolvedValueOnce(makeSnapshots(4) as never)
    const out = await listContextSnapshots('pred-1')
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(out.every(s => Array.isArray(s.sources) && s.sources.length === 1)).toBe(true)
    expect(out.every(s => s.oracleSnapshot != null)).toBe(true)
  })

  it('getContextTimeline strips the tail inside the prediction payload', async () => {
    findFirst.mockResolvedValue({ id: 'pred-1', detailsText: 'x', contextUpdatedAt: new Date() } as never)
    mockHistory(30)
    const out = await getContextTimeline('pred-1')
    expect(out?.id).toBe('pred-1')
    expect(out?.detailsText).toBe('x')
    expect(out?.contextSnapshots[0].sources).not.toEqual([])   // recent kept
    expect(out?.contextSnapshots[25].sources).toEqual([])      // tail stripped
    expect(out?.contextSnapshots[25].externalProbability).toBe(75)  // chart field kept
    // The prediction lookup no longer includes the snapshots: the blobs are read by id.
    expect(findFirst.mock.calls[0][0]!.select).not.toHaveProperty('contextSnapshots')
  })

  it('getContextTimeline returns null when the prediction is missing', async () => {
    findFirst.mockResolvedValue(null)
    findMany.mockReset()
    expect(await getContextTimeline('missing')).toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })
})
