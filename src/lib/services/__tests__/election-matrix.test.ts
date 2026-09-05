import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findMany: vi.fn() },
    evidencePoolArticle: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

import { prisma } from '@/lib/prisma'
import { getElectionMatrix } from '../elections'

const mockPredictions = vi.mocked(prisma.prediction.findMany)
const mockPoolRows = vi.mocked(prisma.evidencePoolArticle.findMany)
const mockQueryRaw = vi.mocked(prisma.$queryRaw)

const CASPIT_ID = '6b9ee26f-b1be-4ad4-be60-0a747a2caf07'

function predictionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    slug: 'knesset-dissolves',
    claimText: 'The Knesset dissolves before 2027',
    resolveByDatetime: new Date('2026-11-01T00:00:00.000Z'),
    status: 'ACTIVE',
    ...over,
  }
}

/** One row of the latest-evidence DISTINCT ON query, already projected to two numbers. */
function latestRow(over: Record<string, unknown> = {}) {
  return { predictionId: 'p1', externalProbability: null, mean: 62.4, ...over }
}

function poolRow(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    predictionId: 'p1',
    url: 'https://t.me/Ben_Caspit/1',
    source: 'Telegram',
    author: null,
    personId: CASPIT_ID,
    title: null,
    stance: 0.8,
    certainty: 0.9,
    claims: ['dissolution imminent'],
    ...over,
  }
}

/** The template-string SQL a `$queryRaw` call was given, joined for text assertions. */
function rawSql(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join('?')
}

describe('getElectionMatrix (pool-fed, Phase 2.3)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('draws cells from usable pool rows, resolving the author by person_id', async () => {
    mockPredictions.mockResolvedValue([predictionRow()] as never)
    mockQueryRaw.mockResolvedValue([latestRow()] as never)
    mockPoolRows.mockResolvedValue([
      // No author string and no alias-matchable source — only person_id identifies Caspit.
      poolRow(),
      poolRow({ id: 'a2', url: 'https://t.me/Ben_Caspit/2', stance: 0.6, certainty: 0.7, claims: [] }),
      poolRow({ id: 'a3', url: 'https://r.com/1', personId: null, author: 'Some Rando', source: 'Reuters', stance: -0.9 }),
    ] as never)

    const matrix = await getElectionMatrix()
    const caspit = matrix.authors.find((a) => a.key === 'ben-caspit')!
    expect(caspit.cells['p1'].stance).toBeCloseTo(0.7) // mean of 0.8 and 0.6
    expect(caspit.cells['p1'].certainty).toBe(0.9) // max
    expect(caspit.cells['p1'].claim).toBe('dissolution imminent')
    expect(caspit.coverage).toBe(1)
    expect(matrix.events[0].probabilityYes).toBe(62) // still snapshot-fed (percent mean)
  })

  it('queries only usable, stance-bearing pool rows, and only the cell fields', async () => {
    mockPredictions.mockResolvedValue([predictionRow()] as never)
    mockQueryRaw.mockResolvedValue([] as never)
    mockPoolRows.mockResolvedValue([] as never)

    await getElectionMatrix()

    expect(mockPoolRows.mock.calls[0][0]).toMatchObject({
      where: { predictionId: { in: ['p1'] }, status: 'COMPLETE', excluded: false, stance: { not: null } },
    })
    // The full row carries the extractor's text fields; a cell reads none of them.
    const select = mockPoolRows.mock.calls[0][0]!.select as Record<string, unknown>
    expect(Object.keys(select).sort()).toEqual(
      ['author', 'certainty', 'claims', 'personId', 'predictionId', 'source', 'stance', 'title', 'url'],
    )
  })

  it('leaves every cell absent for a forecast with no usable pool rows', async () => {
    mockPredictions.mockResolvedValue([predictionRow()] as never)
    mockQueryRaw.mockResolvedValue([latestRow({ externalProbability: 40, mean: null })] as never)
    mockPoolRows.mockResolvedValue([] as never)

    const matrix = await getElectionMatrix()
    expect(matrix.events[0].probabilityYes).toBe(40)
    expect(matrix.authors.every((a) => a.cells['p1'] === undefined)).toBe(true)
  })

  it('has no probability for a forecast without an evidence snapshot', async () => {
    mockPredictions.mockResolvedValue([predictionRow()] as never)
    mockQueryRaw.mockResolvedValue([] as never)
    mockPoolRows.mockResolvedValue([] as never)

    const matrix = await getElectionMatrix()
    expect(matrix.events[0].probabilityYes).toBeNull()
  })
})

describe('getElectionMatrix — latest snapshot per forecast', () => {
  beforeEach(() => vi.clearAllMocks())

  it('picks the newest evidence snapshot in SQL (DISTINCT ON) instead of a nested take', async () => {
    mockPredictions.mockResolvedValue([predictionRow(), predictionRow({ id: 'p2', slug: 'p2' })] as never)
    mockQueryRaw.mockResolvedValue([latestRow(), latestRow({ predictionId: 'p2', mean: 10 })] as never)
    mockPoolRows.mockResolvedValue([] as never)

    const matrix = await getElectionMatrix()
    expect(matrix.events.map((e) => e.probabilityYes)).toEqual([62, 10])

    // Prisma 7 emits no LIMIT for a nested `take`, so the winner has to be chosen in SQL.
    // The mock ignores the SQL, so the query shape is pinned here: one winning id per
    // forecast chosen without reading `oracle_snapshot`; the mean comes from the scalar
    // mirror column, so the blob is never projected.
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
    const sql = rawSql(mockQueryRaw.mock.calls[0])
    expect(sql).toContain('DISTINCT ON ("predictionId") id')
    expect(sql).toContain("kind = 'evidence'")
    expect(sql).toContain('ORDER BY "predictionId", "createdAt" DESC')
    expect(sql).toContain('s.oracle_mean AS mean')
    expect(sql).not.toContain("oracle_snapshot ->")
    expect(sql).not.toContain('LIMIT')
    // The IN-list is the forecasts just loaded, joined as one bound list.
    const inList = mockQueryRaw.mock.calls[0][1] as { values?: unknown[] }
    expect(inList.values).toEqual(['p1', 'p2'])
  })

  it('skips the snapshot query when no forecast carries the election tag', async () => {
    mockPredictions.mockResolvedValue([] as never)
    mockPoolRows.mockResolvedValue([] as never)

    const matrix = await getElectionMatrix()
    expect(matrix.events).toEqual([])
    expect(mockQueryRaw).not.toHaveBeenCalled()
  })
})

describe('getElectionMatrix — superseded rows (daatan#1699)', () => {
  it('asks the pool for current readings only, not every reading ever taken', async () => {
    mockPredictions.mockResolvedValue([predictionRow()] as never)
    mockQueryRaw.mockResolvedValue([] as never)
    mockPoolRows.mockResolvedValue([] as never)

    await getElectionMatrix()

    // The mock ignores `where`, so this asserts on the query itself — a missing
    // predicate can only be pinned by the predicate. Measured on prod 2026-08-31:
    // without it, 946 of the 1,858 rows this aggregated were superseded duplicates.
    const where = mockPoolRows.mock.calls[0][0]!.where as Record<string, unknown>
    expect(where.status).toBe('COMPLETE')
    expect(where.excluded).toBe(false)
    expect(where.supersededAt).toBeNull()
  })
})
