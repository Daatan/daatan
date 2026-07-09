import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    evidencePoolArticle: {
      upsert: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { hashUrl } from '@/lib/utils/hash'
import { addArticlesToPool } from '../evidence-pool'
import type { EnrichedOracleSource } from '../oracle-snapshot'

const upsert = vi.mocked(prisma.evidencePoolArticle.upsert)

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
})
