import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    prediction: { findMany: vi.fn() },
    evidencePoolArticle: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { getElectionMatrix } from '../elections'

const mockPredictions = vi.mocked(prisma.prediction.findMany)
const mockPoolRows = vi.mocked(prisma.evidencePoolArticle.findMany)

const CASPIT_ID = '6b9ee26f-b1be-4ad4-be60-0a747a2caf07'

function predictionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    slug: 'knesset-dissolves',
    claimText: 'The Knesset dissolves before 2027',
    resolveByDatetime: new Date('2026-11-01T00:00:00.000Z'),
    status: 'ACTIVE',
    contextSnapshots: [{ oracleSnapshot: { mean: 62.4 }, externalProbability: null }],
    ...over,
  }
}

function poolRow(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    predictionId: 'p1',
    url: 'https://t.me/Ben_Caspit/1',
    source: 'Telegram',
    author: null,
    personId: CASPIT_ID,
    personName: 'Ben Caspit',
    outletId: null,
    outletName: null,
    publishedDate: null,
    stance: 0.8,
    certainty: 0.9,
    credibilityWeight: null,
    claims: ['dissolution imminent'],
    settled: null,
    quantitativeEstimate: null,
    evidenceWeight: null,
    relevanceScore: 0.7,
    evidenceClass: 'reporting',
    ...over,
  }
}

describe('getElectionMatrix (pool-fed, Phase 2.3)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('draws cells from usable pool rows, resolving the author by person_id', async () => {
    mockPredictions.mockResolvedValue([predictionRow()] as never)
    mockPoolRows.mockResolvedValue([
      // No author string and no alias-matchable source — only person_id identifies Caspit.
      poolRow(),
      poolRow({ id: 'a2', url: 'https://t.me/Ben_Caspit/2', stance: 0.6, certainty: 0.7, claims: [] }),
      poolRow({ id: 'a3', url: 'https://r.com/1', personId: null, personName: null, author: 'Some Rando', source: 'Reuters', stance: -0.9 }),
    ] as never)

    const matrix = await getElectionMatrix()
    const caspit = matrix.authors.find((a) => a.key === 'ben-caspit')!
    expect(caspit.cells['p1'].stance).toBeCloseTo(0.7) // mean of 0.8 and 0.6
    expect(caspit.cells['p1'].certainty).toBe(0.9) // max
    expect(caspit.cells['p1'].claim).toBe('dissolution imminent')
    expect(caspit.coverage).toBe(1)
    expect(matrix.events[0].probabilityYes).toBe(62) // still snapshot-fed (percent mean)
  })

  it('queries only usable, stance-bearing pool rows', async () => {
    mockPredictions.mockResolvedValue([predictionRow()] as never)
    mockPoolRows.mockResolvedValue([] as never)

    await getElectionMatrix()

    expect(mockPoolRows.mock.calls[0][0]).toMatchObject({
      where: { predictionId: { in: ['p1'] }, status: 'COMPLETE', excluded: false, stance: { not: null } },
    })
  })

  it('leaves every cell absent for a forecast with no usable pool rows', async () => {
    mockPredictions.mockResolvedValue([
      predictionRow({ contextSnapshots: [{ oracleSnapshot: null, externalProbability: 40 }] }),
    ] as never)
    mockPoolRows.mockResolvedValue([] as never)

    const matrix = await getElectionMatrix()
    expect(matrix.events[0].probabilityYes).toBe(40)
    expect(matrix.authors.every((a) => a.cells['p1'] === undefined)).toBe(true)
  })
})
