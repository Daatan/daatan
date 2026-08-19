/**
 * One definition of "usable" (daatan#1475).
 *
 * Before this, "a pool row the aggregate can read" was written twice — once in TypeScript
 * inside `recomputeFromPool`, once as a Prisma `where` in the evidence-health alert — and
 * the two disagreed: the alert counted any row carrying a stance, while the aggregate also
 * required certainty, credibility and relevance. A forecast whose pool held only
 * half-extracted rows was therefore invisible to the alert built to catch exactly it.
 *
 * These tests pin the predicate and the SQL against ONE field list. Adding a condition to
 * either side without the other fails here, which is the whole point of the file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: { evidencePoolArticle: { count: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { isUsablePoolRow, USABLE_POOL_ROW_WHERE, countUsableEvidence } from '@/lib/services/evidence-pool'

type Row = Parameters<typeof isUsablePoolRow>[0]

const USABLE: Row = {
  excluded: false,
  status: 'COMPLETE',
  stance: 0.4,
  certainty: 0.8,
  credibilityWeight: 1,
  relevanceScore: 0.6,
}

/** Each field the definition reads, and a value of it that makes a row unreadable. */
const DISQUALIFIERS: Array<[keyof Row, unknown]> = [
  ['excluded', true],
  ['status', 'FAILED'],
  ['stance', null],
  ['certainty', null],
  ['credibilityWeight', null],
  ['relevanceScore', null],
]

/**
 * Enough of Prisma's filter grammar to evaluate {@link USABLE_POOL_ROW_WHERE} in
 * process: scalar equality and `{ not: null }`. If the filter ever grows a construct
 * beyond these two, this throws rather than silently passing the row.
 */
function matchesWhere(where: Record<string, unknown>, row: Record<string, unknown>): boolean {
  return Object.entries(where).every(([field, cond]) => {
    if (cond !== null && typeof cond === 'object') {
      const keys = Object.keys(cond)
      if (keys.length !== 1 || keys[0] !== 'not' || (cond as { not: unknown }).not !== null) {
        throw new Error(`unsupported filter on ${field}: ${JSON.stringify(cond)}`)
      }
      return row[field] !== null && row[field] !== undefined
    }
    return row[field] === cond
  })
}

describe('the usable-pool-row definition (daatan#1475)', () => {
  it('accepts a fully extracted, included row', () => {
    expect(isUsablePoolRow(USABLE)).toBe(true)
  })

  it.each(DISQUALIFIERS)('rejects a row on %s', (field, bad) => {
    expect(isUsablePoolRow({ ...USABLE, [field]: bad })).toBe(false)
  })

  it('rejects a row that is merely PENDING, not only one that FAILED', () => {
    // The aggregate reads a snapshot of a pool still being extracted; an in-flight row
    // is not evidence yet.
    expect(isUsablePoolRow({ ...USABLE, status: 'PENDING' })).toBe(false)
  })

  it('accepts the boundary values — zero stance is a reading, not a missing one', () => {
    // A row that argues neither way still tells the aggregate something, and a zero
    // credibility weight is a deliberate weighting, not an absence. Only null is absence.
    expect(isUsablePoolRow({ ...USABLE, stance: 0, certainty: 0, credibilityWeight: 0, relevanceScore: 0 })).toBe(true)
  })

  it('gates on the same fields as the SQL, and only those', () => {
    // Guards the divergence this file exists to prevent, in both directions: a condition
    // added to the query without the predicate, or the reverse.
    const sqlFields = Object.keys(USABLE_POOL_ROW_WHERE).filter((f) => f !== 'supersededAt')
    expect(sqlFields.sort()).toEqual(DISQUALIFIERS.map(([f]) => f).sort())
  })

  it('agrees with the SQL row by row, including on every disqualifier', () => {
    const rows: Row[] = [USABLE, ...DISQUALIFIERS.map(([f, bad]) => ({ ...USABLE, [f]: bad }) as Row)]
    for (const row of rows) {
      expect(matchesWhere(USABLE_POOL_ROW_WHERE, { supersededAt: null, ...row })).toBe(isUsablePoolRow(row))
    }
  })

  it('excludes superseded rows from the query — the predicate never sees them', () => {
    // A re-extraction supersedes the row it replaces; counting both would double the pool.
    // Only the SQL can express this, so the predicate deliberately says nothing about it.
    expect(USABLE_POOL_ROW_WHERE.supersededAt).toBeNull()
    expect(matchesWhere(USABLE_POOL_ROW_WHERE, { supersededAt: new Date(), ...USABLE })).toBe(false)
  })
})

describe('countUsableEvidence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('counts one forecast’s readable rows through the shared filter', async () => {
    vi.mocked(prisma.evidencePoolArticle.count).mockResolvedValue(3 as never)

    await expect(countUsableEvidence('pred-1')).resolves.toBe(3)
    expect(prisma.evidencePoolArticle.count).toHaveBeenCalledWith({
      where: { predictionId: 'pred-1', ...USABLE_POOL_ROW_WHERE },
    })
  })
})
