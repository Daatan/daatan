import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    evidencePoolArticle: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))
vi.mock('@/lib/services/oracleClient', () => ({
  getOracleConfig: vi.fn(() => ({ baseUrl: 'http://oracle', key: 'k' })),
  oracleFetch: vi.fn(),
}))
const mockLogger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => mockLogger,
}))

import { prisma } from '@/lib/prisma'
import { hashUrl } from '@/lib/utils/hash'
import { getOracleConfig, oracleFetch } from '@/lib/services/oracleClient'
import { ClaimDirection } from '@prisma/client'
import { addArticlesToPool, getPoolArticles, setArticleExcluded, shadowCompareRecompute } from '../evidence-pool'
import type { EnrichedOracleSource } from '../oracle-snapshot'

const upsert = vi.mocked(prisma.evidencePoolArticle.upsert)
const findMany = vi.mocked(prisma.evidencePoolArticle.findMany)
const findFirst = vi.mocked(prisma.evidencePoolArticle.findFirst)
const update = vi.mocked(prisma.evidencePoolArticle.update)
const mockGetOracleConfig = vi.mocked(getOracleConfig)
const mockOracleFetch = vi.mocked(oracleFetch)

const source = (over: Partial<EnrichedOracleSource> = {}): EnrichedOracleSource => ({
  sourceId: 's1',
  sourceName: 'Reuters',
  url: 'https://reuters.com/a',
  stance: 0.5,
  certainty: 0.8,
  credibilityWeight: 1,
  claims: ['it will happen'],
  title: 'Headline',
  publishedAt: '2026-06-18',
  author: 'Jane Doe',
  settled: null,
  quantitativeEstimate: null,
  evidenceWeight: null,
  relevanceScore: null,
  ...over,
})

describe('addArticlesToPool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsert.mockResolvedValue({} as never)
  })

  it('upserts keyed by (predictionId, urlHash) with the extracted signal', async () => {
    await addArticlesToPool('pred-1', [source()], 'analyze')

    expect(upsert).toHaveBeenCalledTimes(1)
    const call = upsert.mock.calls[0][0] as {
      where: { predictionId_urlHash: { predictionId: string; urlHash: string } }
      create: Record<string, unknown>
      update: Record<string, unknown>
    }
    expect(call.where.predictionId_urlHash).toEqual({
      predictionId: 'pred-1',
      urlHash: hashUrl('https://reuters.com/a'),
    })
    expect(call.create).toMatchObject({
      predictionId: 'pred-1',
      url: 'https://reuters.com/a',
      stance: 0.5,
      certainty: 0.8,
      origin: 'analyze',
    })
  })

  it('never writes `excluded` (an admin exclusion decision must survive re-discovery)', async () => {
    await addArticlesToPool('pred-1', [source()], 'news-indexer')
    const call = upsert.mock.calls[0][0] as { create: Record<string, unknown>; update: Record<string, unknown> }
    expect(call.create).not.toHaveProperty('excluded')
    expect(call.update).not.toHaveProperty('excluded')
  })

  it('upserts each article in the batch independently', async () => {
    await addArticlesToPool(
      'pred-1',
      [source({ url: 'https://a.com/1' }), source({ url: 'https://b.com/2' })],
      'backfill',
    )
    expect(upsert).toHaveBeenCalledTimes(2)
  })

  it('passes settled/quantitativeEstimate straight through', async () => {
    await addArticlesToPool('pred-1', [source({ settled: true, quantitativeEstimate: 0.22 })], 'analyze')
    const call = upsert.mock.calls[0][0] as { create: Record<string, unknown> }
    expect(call.create).toMatchObject({ settled: true, quantitativeEstimate: 0.22 })
  })

  it('passes evidenceWeight straight through, in both create and update', async () => {
    await addArticlesToPool('pred-1', [source({ evidenceWeight: 4.0 })], 'analyze')
    const call = upsert.mock.calls[0][0] as { create: Record<string, unknown>; update: Record<string, unknown> }
    expect(call.create).toMatchObject({ evidenceWeight: 4.0 })
    expect(call.update).toMatchObject({ evidenceWeight: 4.0 })
  })

  it('passes relevanceScore straight through, in both create and update', async () => {
    await addArticlesToPool('pred-1', [source({ relevanceScore: 0.85 })], 'analyze')
    const call = upsert.mock.calls[0][0] as { create: Record<string, unknown>; update: Record<string, unknown> }
    expect(call.create).toMatchObject({ relevanceScore: 0.85 })
    expect(call.update).toMatchObject({ relevanceScore: 0.85 })
  })
})

describe('getPoolArticles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists a forecast\'s pool, most recently added first', async () => {
    findMany.mockResolvedValue([] as never)
    await getPoolArticles('pred-1')
    expect(findMany).toHaveBeenCalledWith({
      where: { predictionId: 'pred-1' },
      orderBy: { addedAt: 'desc' },
    })
  })
})

describe('setArticleExcluded', () => {
  beforeEach(() => vi.clearAllMocks())

  it('excludes an article that belongs to the given forecast', async () => {
    findFirst.mockResolvedValue({ id: 'art-1', predictionId: 'pred-1' } as never)
    update.mockResolvedValue({ id: 'art-1', excluded: true } as never)

    const result = await setArticleExcluded('pred-1', 'art-1', true)

    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'art-1', predictionId: 'pred-1' } })
    expect(update).toHaveBeenCalledWith({ where: { id: 'art-1' }, data: { excluded: true } })
    expect(result).toMatchObject({ excluded: true })
  })

  it('returns null without updating when the article does not belong to the forecast', async () => {
    findFirst.mockResolvedValue(null)

    const result = await setArticleExcluded('pred-1', 'someone-elses-article', true)

    expect(update).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })
})

const poolArticle = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'art-1',
  predictionId: 'pred-1',
  url: 'https://reuters.com/a',
  urlHash: 'hash-1',
  title: 'Headline',
  source: 'reuters.com',
  publishedDate: '2026-07-01',
  stance: 0.5,
  certainty: 0.8,
  credibilityWeight: 1.0,
  claims: [],
  settled: false,
  quantitativeEstimate: null,
  evidenceWeight: 0.6,
  relevanceScore: 0.9,
  origin: 'analyze',
  excluded: false,
  addedAt: new Date('2026-07-01'),
  updatedAt: new Date('2026-07-01'),
  ...over,
})

const live = { mean: 0.5, ciLow: 0.2, ciHigh: 0.8, settled: false }

describe('shadowCompareRecompute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOracleConfig.mockReturnValue({ baseUrl: 'http://oracle', key: 'k' })
  })

  it('does nothing when the Oracle is not configured', async () => {
    mockGetOracleConfig.mockReturnValue(null)
    await shadowCompareRecompute('pred-1', live, null, null)
    expect(findMany).not.toHaveBeenCalled()
    expect(mockOracleFetch).not.toHaveBeenCalled()
  })

  it('does nothing when the pool is empty', async () => {
    findMany.mockResolvedValue([] as never)
    await shadowCompareRecompute('pred-1', live, null, null)
    expect(mockOracleFetch).not.toHaveBeenCalled()
  })

  it('does nothing when every pool article is excluded or missing required fields', async () => {
    findMany.mockResolvedValue([
      poolArticle({ excluded: true }),
      poolArticle({ id: 'art-2', stance: null }),
    ] as never)
    await shadowCompareRecompute('pred-1', live, null, null)
    expect(mockOracleFetch).not.toHaveBeenCalled()
  })

  it('calls /pool/aggregate with only usable articles, mapped to the wire shape', async () => {
    findMany.mockResolvedValue([
      poolArticle(),
      poolArticle({ id: 'art-2', excluded: true }),
      poolArticle({ id: 'art-3', relevanceScore: null }),
    ] as never)
    mockOracleFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ mean: 0.6, ci_low: 0.3, ci_high: 0.9, articles_used: 1, settled: false, insufficient_data: false, reason: null }),
    } as never)

    await shadowCompareRecompute('pred-1', live, ClaimDirection.ARRIVAL, new Date('2099-01-01'))

    expect(mockOracleFetch).toHaveBeenCalledTimes(1)
    const [, path, init] = mockOracleFetch.mock.calls[0]
    expect(path).toBe('/pool/aggregate')
    const body = JSON.parse((init as { body: string }).body)
    expect(body.sources).toHaveLength(1)
    expect(body.sources[0]).toMatchObject({
      stance: 0.5,
      certainty: 0.8,
      credibility_weight: 1.0,
      relevance_score: 0.9,
      evidence_weight: 0.6,
      published_date: '2026-07-01',
      settled: false,
    })
    expect(body.claim_direction).toBe('arrival')
    expect(body.claim_deadline).toBe(new Date('2099-01-01').toISOString())
  })

  it('logs a comparison between the live and recomputed estimate on success', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOracleFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ mean: 0.62, ci_low: 0.3, ci_high: 0.9, articles_used: 1, settled: true, insufficient_data: false, reason: null }),
    } as never)

    await shadowCompareRecompute('pred-1', live, null, null)

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        predictionId: 'pred-1',
        liveMean: 0.5,
        recomputeMean: 0.62,
        meanDelta: expect.closeTo(0.12, 5),
        liveSettled: false,
        recomputeSettled: true,
      }),
      'event=pool_recompute_shadow',
    )
  })

  it('never throws when the Oracle returns a non-OK status', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOracleFetch.mockResolvedValue({ ok: false, status: 500 } as never)
    await expect(shadowCompareRecompute('pred-1', live, null, null)).resolves.toBeUndefined()
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('never throws when the fetch itself rejects', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOracleFetch.mockRejectedValue(new Error('network down'))
    await expect(shadowCompareRecompute('pred-1', live, null, null)).resolves.toBeUndefined()
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})
