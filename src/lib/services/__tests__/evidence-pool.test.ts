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

import { prisma } from '@/lib/prisma'
import { hashUrl } from '@/lib/utils/hash'
import { addArticlesToPool, getPoolArticles, setArticleExcluded } from '../evidence-pool'
import type { EnrichedOracleSource } from '../oracle-snapshot'

const upsert = vi.mocked(prisma.evidencePoolArticle.upsert)
const findMany = vi.mocked(prisma.evidencePoolArticle.findMany)
const findFirst = vi.mocked(prisma.evidencePoolArticle.findFirst)
const update = vi.mocked(prisma.evidencePoolArticle.update)

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
