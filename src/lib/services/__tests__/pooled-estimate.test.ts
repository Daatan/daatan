/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { EvidencePoolArticle } from '@prisma/client'

const { mockRecompute, mockMeta, mockLatestSnapshot } = vi.hoisted(() => ({
  mockRecompute: vi.fn(),
  mockMeta: vi.fn(),
  mockLatestSnapshot: vi.fn(),
}))

vi.mock('@/lib/services/evidence-pool', () => ({
  recomputeFromPool: (...a: unknown[]) => mockRecompute(...a),
}))
vi.mock('@/lib/services/forecast-sources', () => ({
  getArticleMetaByUrl: (...a: unknown[]) => mockMeta(...a),
}))
vi.mock('@/lib/services/context', () => ({
  getLatestOracleSnapshot: (...a: unknown[]) => mockLatestSnapshot(...a),
}))

import { resolvePooledEstimate, type SingleRunEstimate } from '../pooled-estimate'

const SINGLE_RUN: SingleRunEstimate = {
  mean: 0.5,
  std: 0.1,
  ciLow: 0.2,
  ciHigh: 0.8,
  settled: false,
  articlesUsed: 1,
}

const FALLBACK_SOURCES = [
  { sourceId: 's1', sourceName: 'BBC', url: 'https://bbc.com/x', stance: 0.42, certainty: 0.7, credibilityWeight: 1, claims: ['c'], title: 'T', publishedAt: null, author: null, personId: null, personName: null, outletId: null, outletName: null, settled: null, settlementEventDate: null, quantitativeEstimate: null, evidenceWeight: null, relevanceScore: null, evidenceClass: null, authorLean: null, authorLeanCertainty: null, factSignal: null, eventActors: null, eventTarget: null, isOccurrence: null, verified: null, claimsDetail: null, carriedForward: false },
]

const poolRow = (over: Partial<EvidencePoolArticle>): EvidencePoolArticle =>
  ({
    id: 'row',
    predictionId: 'p1',
    url: 'https://example.com/a',
    urlHash: 'h',
    title: 'T',
    source: 'example.com',
    publishedDate: '2026-07-01',
    contentHash: null,
    status: 'COMPLETE',
    statusReason: null,
    stance: 0.1,
    certainty: 0.7,
    credibilityWeight: 1,
    claims: ['pooled claim'],
    settled: false,
    settlementEventDate: null,
    quantitativeEstimate: null,
    evidenceWeight: 0.6,
    relevanceScore: 0.8,
    evidenceClass: 'reported_fact',
    origin: 'analyze',
    excluded: false,
    addedAt: new Date('2026-07-01'),
    updatedAt: new Date('2026-07-01'),
    ...over,
  }) as EvidencePoolArticle

const poolResult = (over: Record<string, unknown> = {}) => ({
  mean: -0.2, std: 0.5, ciLow: -0.7, ciHigh: 0.3,
  settled: false, articlesUsed: 2, insufficientData: false, reason: null,
  poolSize: 3, usableSize: 2, excludedCount: 0, incompleteCount: 1,
  usableArticles: [
    poolRow({ id: 'r1', url: 'https://reuters.com/p', source: 'reuters.com' }),
    poolRow({ id: 'r2', url: 'https://guardian.com/p', source: 'guardian.com' }),
  ],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockMeta.mockResolvedValue(new Map())
  mockLatestSnapshot.mockResolvedValue(null)
})

describe('resolvePooledEstimate', () => {
  it('returns the whole-pool aggregate and lists exactly its rows when the pool can aggregate', async () => {
    mockRecompute.mockResolvedValue(poolResult())

    const out = await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, null, null)

    expect(out.estimateSource).toBe('pool')
    expect(out.mean).toBe(-0.2) // the pool, not the single run's 0.5
    expect(out.articlesUsed).toBe(2)
    expect(out.snapshotSources).toHaveLength(2) // === articlesUsed
    expect(out.snapshotSources.map((s) => s.url)).toEqual(['https://reuters.com/p', 'https://guardian.com/p'])
    expect(out.snapshotSources[0]).toMatchObject({ sourceName: 'reuters.com', claims: ['pooled claim'] })
    expect(out.poolSize).toBe(3)
    expect(out.singleRunMean).toBe(0.5)
  })

  it('forwards the claim window metadata to the recompute', async () => {
    mockRecompute.mockResolvedValue(poolResult())
    const createdAt = new Date('2026-07-04T10:00:00Z')

    await resolvePooledEstimate(
      'p1', SINGLE_RUN, FALLBACK_SOURCES, 'ARRIVAL' as never, new Date('2026-07-19T23:59:59Z'),
      new Map(), createdAt, 'SCHEDULED' as never, 'Will the bill pass by July?',
    )

    expect(mockRecompute).toHaveBeenCalledWith(
      'p1', 'ARRIVAL', new Date('2026-07-19T23:59:59Z'), createdAt, 'SCHEDULED', 'Will the bill pass by July?',
    )
  })

  // daatan#1264 — claimText is what lets the settlement match gate run on the recompute
  // path. Forgetting it is silent (retro skips with `reason=no_question`), so the default
  // is pinned here rather than left to each caller's discretion.
  it('defaults claimText to null when a caller does not thread it', async () => {
    mockRecompute.mockResolvedValue(poolResult())

    await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, null, null)

    expect(mockRecompute).toHaveBeenCalledWith('p1', null, null, null, null, null)
  })

  it('defaults the claim window metadata to null for callers that do not pass it', async () => {
    mockRecompute.mockResolvedValue(poolResult())

    await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, null, null)

    expect(mockRecompute).toHaveBeenCalledWith('p1', null, null, null, null, null)
  })

  it('falls back to the single run (and its own sources) when the pool cannot aggregate', async () => {
    mockRecompute.mockResolvedValue(null)

    const out = await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, null, null)

    expect(out.estimateSource).toBe('single-run')
    expect(out.mean).toBe(0.5)
    expect(out.snapshotSources).toBe(FALLBACK_SOURCES)
    expect(out.poolSize).toBeNull()
    expect(mockMeta).not.toHaveBeenCalled() // no author lookup on the fallback path
  })

  it('ABSTAINS (does not fall back) when the pool aggregated but found no usable signal', async () => {
    // The pool was read and judged the whole set off-topic — falling back to the single run
    // over those same articles would reintroduce a garbage number, so the caller must abstain.
    mockRecompute.mockResolvedValue(poolResult({ insufficientData: true, reason: 'all_articles_off_topic' }))

    const out = await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, null, null)

    expect(out.estimateSource).toBe('pool-insufficient')
    expect(out.insufficientData).toBe(true)
    expect(out.reason).toBe('all_articles_off_topic')
    expect(out.snapshotSources).toEqual([]) // no voters on an abstention
    expect(out.poolSize).toBe(3)
    expect(mockMeta).not.toHaveBeenCalled() // no author lookup — there are no sources to enrich
  })

  it('distinguishes pool-insufficient (abstain) from pool-unreadable (fall back)', async () => {
    mockRecompute.mockResolvedValue(null) // couldn't read the pool at all
    expect((await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, null, null)).insufficientData).toBe(false)

    mockRecompute.mockResolvedValue(poolResult()) // healthy aggregate
    expect((await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, null, null)).insufficientData).toBe(false)
  })

  it('never throws — a recompute that throws degrades to the single run', async () => {
    mockRecompute.mockRejectedValue(new Error('pool read failed'))

    const out = await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, null, null)

    expect(out.estimateSource).toBe('single-run')
    expect(out.mean).toBe(0.5)
  })

  it('looks up authors only for pooled URLs not already known, and writes them onto the sources', async () => {
    mockRecompute.mockResolvedValue(poolResult())
    mockMeta.mockResolvedValue(
      new Map([['https://guardian.com/p', { requestedUrl: 'https://guardian.com/p', author: 'Pool Byline', publishedAt: null, title: null, source: null }]]),
    )
    // reuters already known (with a byline); only guardian should be fetched
    const known = new Map<string, string | null>([['https://reuters.com/p', 'Known Author']])

    const out = await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, null, null, known)

    expect(mockMeta).toHaveBeenCalledWith(['https://guardian.com/p'])
    expect(out.snapshotSources.find((s) => s.url === 'https://reuters.com/p')?.author).toBe('Known Author')
    expect(out.snapshotSources.find((s) => s.url === 'https://guardian.com/p')?.author).toBe('Pool Byline')
  })

  it('keeps a pooled article whose byline is unknown, with a null author', async () => {
    mockRecompute.mockResolvedValue(poolResult())
    mockMeta.mockResolvedValue(new Map())

    const out = await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, null, null)

    expect(out.snapshotSources).toHaveLength(2)
    expect(out.snapshotSources.every((s) => s.author === null)).toBe(true)
  })

  it('forwards claimDirection/claimDeadline to the recompute', async () => {
    const deadline = new Date('2026-12-31T00:00:00.000Z')
    mockRecompute.mockResolvedValue(null)

    await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, 'ARRIVAL', deadline)

    expect(mockRecompute).toHaveBeenCalledWith('p1', 'ARRIVAL', deadline, null, null, null)
  })

  describe('carriedForward (daatan#1166)', () => {
    it('marks every source not carried-forward when there is no prior snapshot', async () => {
      mockRecompute.mockResolvedValue(poolResult())
      mockLatestSnapshot.mockResolvedValue(null)

      const out = await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, null, null)

      expect(mockLatestSnapshot).toHaveBeenCalledWith('p1')
      expect(out.snapshotSources.every((s) => s.carriedForward === false)).toBe(true)
    })

    it('marks a source carried-forward only when its stance is unchanged from the prior snapshot', async () => {
      mockRecompute.mockResolvedValue(poolResult()) // reuters stance 0.1, guardian stance 0.1 (poolRow default)
      mockLatestSnapshot.mockResolvedValue({
        createdAt: new Date('2026-07-01'),
        oracleSnapshot: {
          sources: [
            { url: 'https://reuters.com/p', stance: 0.1 }, // unchanged
            { url: 'https://guardian.com/p', stance: 0.9 }, // changed
          ],
        },
      })

      const out = await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, null, null)

      expect(out.snapshotSources.find((s) => s.url === 'https://reuters.com/p')?.carriedForward).toBe(true)
      expect(out.snapshotSources.find((s) => s.url === 'https://guardian.com/p')?.carriedForward).toBe(false)
    })

    it('treats a source absent from the prior snapshot as not carried-forward (genuinely new)', async () => {
      mockRecompute.mockResolvedValue(poolResult())
      mockLatestSnapshot.mockResolvedValue({
        createdAt: new Date('2026-07-01'),
        oracleSnapshot: { sources: [{ url: 'https://some-other-source.com/p', stance: 0.1 }] },
      })

      const out = await resolvePooledEstimate('p1', SINGLE_RUN, FALLBACK_SOURCES, null, null)

      expect(out.snapshotSources.every((s) => s.carriedForward === false)).toBe(true)
    })
  })
})
