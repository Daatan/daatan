import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    predictionOutcomeCutoff: { findMany: vi.fn(), create: vi.fn() },
  },
}))

// The elections app implements the same rule (its src/lib/elections/outcome-cutoff.ts) and
// carries this same table in its own test. Change both together.
const CUTOFF = '2026-10-27T18:00:00Z'
const EARLY_CUTOFF = '2026-10-27T10:00:00Z'
const CASES: [published: string | null, cutoff: string, eligible: boolean, why: string][] = [
  [null, CUTOFF, false, 'undated'],
  ['', CUTOFF, false, 'empty'],
  ['yesterday', CUTOFF, false, 'unparseable'],
  ['2026-10-27T17:59:59+00:00', CUTOFF, true, 'one second before'],
  ['2026-10-27T18:00:00+00:00', CUTOFF, false, 'exactly at the cutoff'],
  ['2026-10-27T20:30:00+03:00', CUTOFF, true, 'offset time that is 17:30 UTC'],
  ['2026-10-27T21:30:00+03:00', CUTOFF, false, 'offset time that is 18:30 UTC'],
  ['2026-10-27T00:00:00+02:00', CUTOFF, true, 'local midnight is a real instant, not a placeholder'],
  ['2026-10-27', CUTOFF, false, 'date-only on the cutoff day'],
  ['2026-10-27T00:00:00+00:00', CUTOFF, false, 'midnight-UTC placeholder on the cutoff day'],
  ['2026-10-27T00:00:00Z', CUTOFF, false, 'midnight-UTC placeholder, Z form'],
  ['2026-10-26', CUTOFF, true, 'previous day is over everywhere by 12:00 UTC'],
  ['2026-10-26T00:00:00+00:00', CUTOFF, true, 'previous day, placeholder form'],
  ['2026-10-26', EARLY_CUTOFF, false, 'previous day may still be running in UTC-12'],
  ['2026-10-25', EARLY_CUTOFF, true, 'two days before'],
]

describe('isPublishedBeforeCutoff', () => {
  it.each(CASES)('%s vs %s -> %s (%s)', async (published, cutoff, eligible) => {
    const { isPublishedBeforeCutoff } = await import('../outcome-cutoff')
    expect(isPublishedBeforeCutoff(published, new Date(cutoff))).toBe(eligible)
  })

  it('never admits more readings when the cutoff moves earlier', async () => {
    const { isPublishedBeforeCutoff } = await import('../outcome-cutoff')
    for (const [published] of CASES) {
      const early = isPublishedBeforeCutoff(published, new Date(EARLY_CUTOFF))
      const late = isPublishedBeforeCutoff(published, new Date(CUTOFF))
      expect(early && !late).toBe(false)
    }
  })
})

describe('isScorableReading', () => {
  it('scores nothing on a forecast with no cutoff', async () => {
    const { isScorableReading } = await import('../outcome-cutoff')
    expect(isScorableReading({ publishedDate: '2026-01-01T10:00:00Z' }, undefined)).toBe(false)
    expect(isScorableReading({ publishedDate: '2026-01-01T10:00:00Z' }, null)).toBe(false)
  })

  it('never scores a reading that reports the outcome as settled, whatever its timestamp', async () => {
    const { isScorableReading } = await import('../outcome-cutoff')
    const cutoff = new Date(CUTOFF)
    expect(isScorableReading({ publishedDate: '2026-10-20T10:00:00Z', settled: true }, cutoff)).toBe(false)
    expect(isScorableReading({ publishedDate: '2026-10-20T10:00:00Z', settled: false }, cutoff)).toBe(true)
    expect(isScorableReading({ publishedDate: '2026-10-20T10:00:00Z', settled: null }, cutoff)).toBe(true)
  })
})

describe('approvedCutoffs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lets the newest row per forecast decide', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.predictionOutcomeCutoff.findMany).mockResolvedValue([
      { predictionId: 'p1', status: 'approved', cutoffAt: new Date('2026-10-27T18:00:00Z') },
      { predictionId: 'p1', status: 'approved', cutoffAt: new Date('2026-10-27T17:00:00Z') },
      { predictionId: 'p2', status: 'approved', cutoffAt: new Date('2026-11-08T15:00:00Z') },
      { predictionId: 'p2', status: 'insufficient', cutoffAt: null },
      { predictionId: 'p3', status: 'insufficient', cutoffAt: null },
    ] as never)

    const { approvedCutoffs } = await import('../outcome-cutoff')
    const cutoffs = await approvedCutoffs(['p1', 'p2', 'p3', 'p4'])

    expect(cutoffs.get('p1')?.toISOString()).toBe('2026-10-27T17:00:00.000Z')
    expect(cutoffs.has('p2')).toBe(false) // later withdrawn as insufficient
    expect(cutoffs.has('p3')).toBe(false)
    expect(cutoffs.has('p4')).toBe(false) // never recorded
  })

  it('does not query for an empty id list', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { approvedCutoffs } = await import('../outcome-cutoff')
    expect((await approvedCutoffs([])).size).toBe(0)
    expect(prisma.predictionOutcomeCutoff.findMany).not.toHaveBeenCalled()
  })
})

describe('recordOutcomeCutoff', () => {
  it('refuses an approved cutoff with no timestamp', async () => {
    const { recordOutcomeCutoff } = await import('../outcome-cutoff')
    await expect(
      recordOutcomeCutoff({
        predictionId: 'p1', status: 'approved', cutoffAt: null, basis: 'x', evidenceUrls: [], recordedBy: 'u1',
      }),
    ).rejects.toThrow(/cutoffAt/)
  })

  it('stores no timestamp for an insufficient decision', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { recordOutcomeCutoff } = await import('../outcome-cutoff')
    await recordOutcomeCutoff({
      predictionId: 'p1', status: 'insufficient', cutoffAt: new Date(), basis: 'no reliable source', evidenceUrls: [], recordedBy: 'u1',
    })
    expect(vi.mocked(prisma.predictionOutcomeCutoff.create).mock.calls[0][0].data.cutoffAt).toBeNull()
  })
})
