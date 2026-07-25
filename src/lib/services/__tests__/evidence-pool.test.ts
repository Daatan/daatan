import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    evidencePoolArticle: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
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
import { Prisma } from '@prisma/client'
import {
  addArticlesToPool,
  getPoolArticles,
  setArticleExcluded,
  recomputeFromPool,
  pushCredibilityFeedback,
  claimArticleForExtraction,
  claimArticlesForExtraction,
  failClaimedArticles,
  hashArticleContent,
} from '../evidence-pool'
import type { EnrichedOracleSource } from '../oracle-snapshot'

const upsert = vi.mocked(prisma.evidencePoolArticle.upsert)
const findMany = vi.mocked(prisma.evidencePoolArticle.findMany)
const findFirst = vi.mocked(prisma.evidencePoolArticle.findFirst)
const update = vi.mocked(prisma.evidencePoolArticle.update)
const create = vi.mocked(prisma.evidencePoolArticle.create)
const updateMany = vi.mocked(prisma.evidencePoolArticle.updateMany)
const mockGetOracleConfig = vi.mocked(getOracleConfig)
const mockOracleFetch = vi.mocked(oracleFetch)

/** A P2002 unique-constraint-violation error, as Prisma throws it. */
function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '7.8.0',
  })
}

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
  personId: null,
  personName: null,
  outletId: null,
  outletName: null,
  settled: null,
  settlementEventDate: null,
  quantitativeEstimate: null,
  evidenceWeight: null,
  relevanceScore: null,
  evidenceClass: null,
  authorLean: null,
  authorLeanCertainty: null,
  factSignal: null,
  eventActors: null,
  eventTarget: null,
  isOccurrence: null,
  verified: null,
  carriedForward: false,
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

  it('persists the resolved author identity on the pool row (Phase 2)', async () => {
    await addArticlesToPool(
      'pred-1',
      [source({ author: 'בן כספית', personId: 'p-9', personName: 'Ben Caspit' })],
      'news-indexer',
    )
    const call = upsert.mock.calls[0][0] as { create: Record<string, unknown>; update: Record<string, unknown> }
    const identity = { author: 'בן כספית', personId: 'p-9', personName: 'Ben Caspit' }
    expect(call.create).toMatchObject(identity)
    expect(call.update).toMatchObject(identity)
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

  it('persists the shadow authorLean/authorLeanCertainty, in both create and update', async () => {
    // Author-scoring lane (retro #308/#309) — written to the pool row but never read by any
    // estimate. Verifies the un-fusing shadow column is actually persisted, both branches.
    await addArticlesToPool('pred-1', [source({ authorLean: -0.6, authorLeanCertainty: 0.4 })], 'analyze')
    const call = upsert.mock.calls[0][0] as { create: Record<string, unknown>; update: Record<string, unknown> }
    expect(call.create).toMatchObject({ authorLean: -0.6, authorLeanCertainty: 0.4 })
    expect(call.update).toMatchObject({ authorLean: -0.6, authorLeanCertainty: 0.4 })
  })

  it('persists the shadow factSignal + facets, in both create and update', async () => {
    // Estimator lane (retro #313) — the fact-lane counterpart of stance, written to the pool
    // row but never read by any estimate and never sent to /pool/aggregate. Verifies all five
    // shadow columns are actually persisted, both branches.
    const facts = {
      factSignal: 0.3,
      eventActors: 'Israel',
      eventTarget: 'Iran',
      isOccurrence: false,
      verified: true,
    }
    await addArticlesToPool('pred-1', [source(facts)], 'analyze')
    const call = upsert.mock.calls[0][0] as { create: Record<string, unknown>; update: Record<string, unknown> }
    expect(call.create).toMatchObject(facts)
    expect(call.update).toMatchObject(facts)
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
  settlementEventDate: null,
  quantitativeEstimate: null,
  evidenceWeight: 0.6,
  relevanceScore: 0.9,
  evidenceClass: 'reported_fact',
  origin: 'analyze',
  excluded: false,
  author: null,
  outletName: null,
  authorLean: null,
  authorLeanCertainty: null,
  addedAt: new Date('2026-07-01'),
  updatedAt: new Date('2026-07-01'),
  ...over,
})


const AGGREGATE = {
  mean: 0.6,
  std: 0.25,
  ci_low: 0.3,
  ci_high: 0.9,
  articles_used: 4,
  settled: false,
  insufficient_data: false,
  reason: null,
}

describe('recomputeFromPool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOracleConfig.mockReturnValue({ baseUrl: 'http://oracle', key: 'k' })
  })

  it('returns the aggregate, converted to camelCase, with the pool census attached', async () => {
    findMany.mockResolvedValue([
      poolArticle(),
      poolArticle({ id: 'art-2' }),
      poolArticle({ id: 'art-3', excluded: true }),
      poolArticle({ id: 'art-4', stance: null }),
    ] as never)
    mockOracleFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    const out = await recomputeFromPool('pred-1', null, null)

    expect(out).toEqual({
      mean: 0.6,
      std: 0.25, // carried through — the snapshot's std must describe the pool, not one article
      ciLow: 0.3,
      ciHigh: 0.9,
      articlesUsed: 4,
      settled: false,
      insufficientData: false,
      reason: null,
      poolSize: 4,
      usableSize: 2,
      excludedCount: 1,
      incompleteCount: 1,
      // The exact rows that were POSTed — art-1 and art-2. The excluded (art-3) and
      // stance-less (art-4) rows are dropped, so the caller can list precisely the
      // articles the estimate averages.
      usableArticles: [poolArticle(), poolArticle({ id: 'art-2' })],
    })
  })

  it('returns usableArticles equal to the rows it POSTed — nothing more, nothing less', async () => {
    findMany.mockResolvedValue([
      poolArticle(),
      poolArticle({ id: 'art-2', excluded: true }),
      poolArticle({ id: 'art-3', relevanceScore: null }),
    ] as never)
    mockOracleFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    const out = await recomputeFromPool('pred-1', null, null)

    const posted = JSON.parse((mockOracleFetch.mock.calls[0][2] as { body: string }).body).sources
    expect(out?.usableArticles).toHaveLength(posted.length)
    expect(out?.usableArticles.map((a) => a.id)).toEqual(['art-1'])
  })

  it('sends each row\'s settlement anchor date and the claim window metadata', async () => {
    findMany.mockResolvedValue([
      poolArticle({ settled: true, settlementEventDate: '2026-07-14' }),
      poolArticle({ id: 'art-2' }),
    ] as never)
    mockOracleFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    await recomputeFromPool('pred-1', 'ARRIVAL' as never, new Date('2026-07-19T23:59:59Z'), new Date('2026-07-04T10:00:00Z'), 'SCHEDULED' as never)

    const body = JSON.parse((mockOracleFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.sources[0].settlement_event_date).toBe('2026-07-14')
    expect(body.sources[1].settlement_event_date).toBeNull()
    expect(body.claim_created_at).toBe('2026-07-04T10:00:00.000Z')
    expect(body.claim_archetype).toBe('scheduled')
  })

  it('omits claim_created_at/claim_archetype entirely when unclassified — retro must fail open', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOracleFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    await recomputeFromPool('pred-1', null, null)

    const body = JSON.parse((mockOracleFetch.mock.calls[0][2] as { body: string }).body)
    expect('claim_created_at' in body).toBe(false)
    expect('claim_archetype' in body).toBe(false)
  })

  it("drops admin-excluded articles from the aggregate, so an exclusion moves the number", async () => {
    findMany.mockResolvedValue([poolArticle(), poolArticle({ id: 'art-2', excluded: true })] as never)
    mockOracleFetch.mockResolvedValue({ ok: true, json: async () => AGGREGATE } as never)

    await recomputeFromPool('pred-1', null, null)

    const [, , init] = mockOracleFetch.mock.calls[0]
    expect(JSON.parse((init as { body: string }).body).sources).toHaveLength(1)
  })

  it('surfaces insufficient_data rather than passing off a non-estimate as one', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOracleFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...AGGREGATE, insufficient_data: true, reason: 'no_decisive_signal' }),
    } as never)

    const out = await recomputeFromPool('pred-1', null, null)

    expect(out).toMatchObject({ insufficientData: true, reason: 'no_decisive_signal' })
  })

  it('returns null when the Oracle is not configured', async () => {
    mockGetOracleConfig.mockReturnValue(null)
    expect(await recomputeFromPool('pred-1', null, null)).toBeNull()
    expect(mockOracleFetch).not.toHaveBeenCalled()
  })

  it('returns null when nothing in the pool is usable', async () => {
    findMany.mockResolvedValue([poolArticle({ excluded: true }), poolArticle({ id: 'a2', certainty: null })] as never)
    expect(await recomputeFromPool('pred-1', null, null)).toBeNull()
    expect(mockOracleFetch).not.toHaveBeenCalled()
  })

  // Both failure paths return null rather than throwing: the caller falls back to its
  // single-run forecast, so a flaky Oracle degrades the estimate instead of dropping it.
  it('returns null (never throws) on a non-OK status', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOracleFetch.mockResolvedValue({ ok: false, status: 503 } as never)
    await expect(recomputeFromPool('pred-1', null, null)).resolves.toBeNull()
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('returns null (never throws) when the fetch rejects', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOracleFetch.mockRejectedValue(new Error('network down'))
    await expect(recomputeFromPool('pred-1', null, null)).resolves.toBeNull()
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})

describe('pushCredibilityFeedback', () => {
  const resolvedAt = new Date('2026-07-17T00:00:00.000Z')

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetOracleConfig.mockReturnValue({ baseUrl: 'http://oracle', key: 'k' })
  })

  it('does nothing when the Oracle is not configured', async () => {
    mockGetOracleConfig.mockReturnValue(null)
    await pushCredibilityFeedback('pred-1', true, resolvedAt)
    expect(findMany).not.toHaveBeenCalled()
    expect(mockOracleFetch).not.toHaveBeenCalled()
  })

  it('does nothing when the pool is empty', async () => {
    findMany.mockResolvedValue([] as never)
    await pushCredibilityFeedback('pred-1', true, resolvedAt)
    expect(mockOracleFetch).not.toHaveBeenCalled()
  })

  it('excludes admin-excluded, opinion-class, and sourceless/stanceless articles', async () => {
    findMany.mockResolvedValue([
      poolArticle({ id: 'art-excluded', excluded: true }),
      poolArticle({ id: 'art-opinion', evidenceClass: 'opinion' }),
      poolArticle({ id: 'art-no-source', source: null }),
      poolArticle({ id: 'art-no-stance', stance: null }),
    ] as never)
    await pushCredibilityFeedback('pred-1', true, resolvedAt)
    expect(mockOracleFetch).not.toHaveBeenCalled()
  })

  it('sends author_signals for non-excluded rows with an author_lean, opinion included', async () => {
    findMany.mockResolvedValue([
      poolArticle({ id: 'art-opinion', evidenceClass: 'opinion', author: 'Ben Caspit', outletName: 'maariv', authorLean: 0.9, authorLeanCertainty: 0.8 }),
      poolArticle({ id: 'art-excluded', excluded: true, authorLean: 0.5 }),
      poolArticle({ id: 'art-no-lean' }),
    ] as never)
    mockOracleFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 1, author_signals_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', false, resolvedAt)

    const body = JSON.parse((mockOracleFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.author_signals).toHaveLength(1)
    expect(body.author_signals[0]).toEqual({
      author: 'Ben Caspit',
      outlet_name: 'maariv',
      author_lean: 0.9,
      author_lean_certainty: 0.8,
      evidence_class: 'opinion',
    })
  })

  it('still pushes when only the author lane has signal — the stance lane being all-opinion must not gate it', async () => {
    findMany.mockResolvedValue([
      poolArticle({ id: 'art-opinion', evidenceClass: 'opinion', author: 'Pundit', authorLean: -0.7 }),
    ] as never)
    mockOracleFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 0, author_signals_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', true, resolvedAt)

    expect(mockOracleFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse((mockOracleFetch.mock.calls[0][2] as { body: string }).body)
    expect(body.sources).toHaveLength(0)
    expect(body.author_signals).toHaveLength(1)
  })

  it('posts usable sources to /leaderboard/ingest, mapped to the wire shape', async () => {
    findMany.mockResolvedValue([
      poolArticle(),
      poolArticle({ id: 'art-2', excluded: true }),
      poolArticle({ id: 'art-3', evidenceClass: 'opinion' }),
    ] as never)
    mockOracleFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', true, resolvedAt)

    expect(mockOracleFetch).toHaveBeenCalledTimes(1)
    const [, path, init] = mockOracleFetch.mock.calls[0]
    expect(path).toBe('/leaderboard/ingest')
    const body = JSON.parse((init as { body: string }).body)
    expect(body.prediction_id).toBe('pred-1')
    expect(body.outcome).toBe(true)
    expect(body.resolved_at).toBe(resolvedAt.toISOString())
    expect(body.sources).toHaveLength(1)
    expect(body.sources[0]).toMatchObject({
      source: 'reuters.com',
      stance: 0.5,
      evidence_class: 'reported_fact',
      credibility_weight: 1.0,
      evidence_weight: 0.6,
    })
  })

  it('logs the ingest result on success', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOracleFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ accepted: true, already_ingested: false, sources_recorded: 1 }),
    } as never)

    await pushCredibilityFeedback('pred-1', false, resolvedAt)

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        predictionId: 'pred-1',
        outcome: false,
        sourcesRecorded: 1,
        alreadyIngested: false,
      }),
      'event=credibility_feedback_ingest',
    )
  })

  it('never throws when the Oracle returns a non-OK status', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOracleFetch.mockResolvedValue({ ok: false, status: 500 } as never)
    await expect(pushCredibilityFeedback('pred-1', true, resolvedAt)).resolves.toBeUndefined()
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it('never throws when the fetch itself rejects', async () => {
    findMany.mockResolvedValue([poolArticle()] as never)
    mockOracleFetch.mockRejectedValue(new Error('network down'))
    await expect(pushCredibilityFeedback('pred-1', true, resolvedAt)).resolves.toBeUndefined()
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})

describe('hashArticleContent', () => {
  it('is stable for the same title+snippet', () => {
    expect(hashArticleContent('T', 'S')).toBe(hashArticleContent('T', 'S'))
  })

  it('changes when the snippet changes (a live-blog update)', () => {
    expect(hashArticleContent('T', 'S1')).not.toBe(hashArticleContent('T', 'S2'))
  })

  it('changes when the title changes', () => {
    expect(hashArticleContent('T1', 'S')).not.toBe(hashArticleContent('T2', 'S'))
  })
})

const article = (over: Partial<{ url: string; title: string; snippet: string; source: string | null; publishedAt: string | null }> = {}) => ({
  url: 'https://reuters.com/a',
  title: 'Headline',
  snippet: 'A snippet',
  source: 'reuters.com',
  publishedAt: '2026-07-01',
  ...over,
})

describe('claimArticleForExtraction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('claims via a plain create when no row exists yet for (predictionId, urlHash)', async () => {
    create.mockResolvedValue({} as never)

    const result = await claimArticleForExtraction('pred-1', article(), 'news-indexer')

    expect(result).toBe('claimed')
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        predictionId: 'pred-1',
        url: 'https://reuters.com/a',
        urlHash: hashUrl('https://reuters.com/a'),
        contentHash: hashArticleContent('Headline', 'A snippet'),
        status: 'PENDING',
        origin: 'news-indexer',
      }),
    })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('falls back to a conditional updateMany on a unique-constraint conflict, and claims when it matches (content changed)', async () => {
    create.mockRejectedValue(uniqueViolation())
    updateMany.mockResolvedValue({ count: 1 })

    const result = await claimArticleForExtraction('pred-1', article(), 'news-indexer')

    expect(result).toBe('claimed')
    expect(updateMany).toHaveBeenCalledTimes(1)
    const call = updateMany.mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> }
    expect(call.where).toMatchObject({ predictionId: 'pred-1', urlHash: hashUrl('https://reuters.com/a') })
    expect(call.data).toMatchObject({ status: 'PENDING', statusReason: null, contentHash: hashArticleContent('Headline', 'A snippet') })
  })

  it('skips when the conditional updateMany matches nothing (same content, still COMPLETE or a fresh in-flight PENDING claim)', async () => {
    create.mockRejectedValue(uniqueViolation())
    updateMany.mockResolvedValue({ count: 0 })

    const result = await claimArticleForExtraction('pred-1', article(), 'news-indexer')
    expect(result).toBe('skip')
  })

  it("the updateMany's WHERE admits a stale PENDING claim, an unchanged-content FAILED row, a null contentHash, and a changed contentHash", async () => {
    create.mockRejectedValue(uniqueViolation())
    updateMany.mockResolvedValue({ count: 1 })

    await claimArticleForExtraction('pred-1', article(), 'news-indexer')

    const call = updateMany.mock.calls[0][0] as { where: { OR: Record<string, unknown>[] } }
    expect(call.where.OR).toEqual(
      expect.arrayContaining([
        { contentHash: null },
        { contentHash: { not: hashArticleContent('Headline', 'A snippet') } },
        { status: 'FAILED' },
        { status: 'PENDING', updatedAt: { lt: expect.any(Date) } },
      ]),
    )
  })

  it('re-throws non-P2002 errors from create rather than treating them as a lost race', async () => {
    create.mockRejectedValue(new Error('connection reset'))
    await expect(claimArticleForExtraction('pred-1', article(), 'news-indexer')).rejects.toThrow('connection reset')
    expect(updateMany).not.toHaveBeenCalled()
  })
})

describe('claimArticlesForExtraction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('claims each article independently and returns per-article results in order', async () => {
    create
      .mockResolvedValueOnce({} as never) // first: new row, claimed
      .mockRejectedValueOnce(uniqueViolation()) // second: conflict, falls to updateMany
    updateMany.mockResolvedValueOnce({ count: 0 }) // second: skip

    const results = await claimArticlesForExtraction(
      'pred-1',
      [article({ url: 'https://a.com/1' }), article({ url: 'https://b.com/2' })],
      'news-indexer',
    )

    expect(results).toEqual(['claimed', 'skip'])
  })
})

describe('failClaimedArticles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks the given URLs FAILED with a truncated reason, scoped to still-PENDING rows', async () => {
    updateMany.mockResolvedValue({ count: 2 })

    await failClaimedArticles('pred-1', ['https://a.com/1', 'https://b.com/2'], 'extractor_error')

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        predictionId: 'pred-1',
        urlHash: { in: [hashUrl('https://a.com/1'), hashUrl('https://b.com/2')] },
        status: 'PENDING',
      },
      data: { status: 'FAILED', statusReason: 'extractor_error' },
    })
  })

  it('does nothing for an empty url list', async () => {
    await failClaimedArticles('pred-1', [], 'extractor_error')
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('never throws when the update itself fails', async () => {
    updateMany.mockRejectedValue(new Error('db down'))
    await expect(failClaimedArticles('pred-1', ['https://a.com/1'], 'extractor_error')).resolves.toBeUndefined()
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})
