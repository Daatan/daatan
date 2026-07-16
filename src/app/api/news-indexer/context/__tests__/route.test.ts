/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { EvidencePoolArticle } from '@prisma/client'

// ---------------------------------------------------------------------------
// Mocks — declared before importing the route under test
// ---------------------------------------------------------------------------
vi.mock('@/env', () => ({ env: { NEWS_INDEXER_SECRET: 'test-secret' } }))

vi.mock('@/lib/prisma', () => ({
  prisma: { prediction: { findUnique: vi.fn() } },
}))

vi.mock('@/lib/services/oracle', () => ({ getOracleForecast: vi.fn() }))
vi.mock('@/lib/services/context', () => ({ saveNewsIndexerMatch: vi.fn() }))
vi.mock('@/lib/services/telegram', () => ({ notifyNewsArticleMatched: vi.fn() }))
vi.mock('@/lib/services/forecast-sources', () => ({ getArticleMetaByUrl: vi.fn() }))
vi.mock('@/lib/services/evidence-pool', () => ({
  addArticlesToPool: vi.fn(),
  recomputeFromPool: vi.fn(),
  claimArticlesForExtraction: vi.fn(),
  failClaimedArticles: vi.fn(),
}))

vi.mock('@/lib/api-error', () => ({
  apiError: (msg: string, status: number) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  handleRouteError: () => new Response(JSON.stringify({ error: 'fail' }), { status: 500 }),
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}))

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------
import { POST } from '../route'
import { prisma } from '@/lib/prisma'
import { getOracleForecast } from '@/lib/services/oracle'
import { saveNewsIndexerMatch } from '@/lib/services/context'
import { notifyNewsArticleMatched } from '@/lib/services/telegram'
import { getArticleMetaByUrl } from '@/lib/services/forecast-sources'
import {
  addArticlesToPool,
  recomputeFromPool,
  claimArticlesForExtraction,
  failClaimedArticles,
} from '@/lib/services/evidence-pool'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VALID_BODY = {
  predictionId: 'pred-1',
  articleUrl: 'https://bbc.com/news/x',
  articleTitle: 'Headline',
  articleSnippet: 'A snippet.',
  articleSource: 'bbc.com',
  publishedAt: '2026-06-10T00:00:00Z',
  similarity: 0.5,
}

function post(secret: string | null, body: unknown = VALID_BODY) {
  return new NextRequest('http://localhost/api/news-indexer/context', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret === null ? {} : { 'x-news-indexer-secret': secret }),
    },
    body: JSON.stringify(body),
  })
}

const ACTIVE_PREDICTION = { id: 'pred-1', claimText: 'Will X happen?', status: 'ACTIVE', confidence: 65 }

// One caller article in, so the Oracle returns exactly one source whose url
// echoes the pushed article (search is skipped — see forecaster.py:506).
const ORACLE_WITH_SOURCE = {
  question: 'Will X happen?',
  mean: 0.5,
  std: 0.1,
  ci_low: 0.2,
  ci_high: 0.8,
  articles_used: 1,
  placeholder: false,
  sources: [
    {
      source_id: 'bbc',
      source_name: 'BBC',
      url: 'https://bbc.com/news/x',
      stance: 0.42,
      certainty: 0.77,
      credibility_weight: 1.0,
      relevance_score: 0.8,
      claims: ['First extracted claim', 'Second claim'],
    },
  ],
}

describe('POST /api/news-indexer/context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue(ACTIVE_PREDICTION as never)
    vi.mocked(saveNewsIndexerMatch).mockResolvedValue({ stored: true })
    vi.mocked(getArticleMetaByUrl).mockResolvedValue(new Map())
    vi.mocked(addArticlesToPool).mockResolvedValue(undefined)
    // Default: no pool aggregate available, so the route falls back to the single-run
    // forecast. That is what every test outside the pool block below asserts against.
    vi.mocked(recomputeFromPool).mockResolvedValue(null)
    // Default: the claim gate always admits the push (existing tests exercise
    // the "something new" path); the skip-when-unchanged path has its own tests below.
    vi.mocked(claimArticlesForExtraction).mockResolvedValue(['claimed'])
    vi.mocked(failClaimedArticles).mockResolvedValue(undefined)
  })

  it('rejects a wrong secret with 401 before doing any work', async () => {
    const res = await POST(post('wrong-secret'))
    expect(res.status).toBe(401)
    expect(getOracleForecast).not.toHaveBeenCalled()
  })

  it('rejects a missing secret header with 401', async () => {
    const res = await POST(post(null))
    expect(res.status).toBe(401)
    expect(getOracleForecast).not.toHaveBeenCalled()
  })

  it('returns the per-article Oracle output so news-indexer can store it', async () => {
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

    const res = await POST(post('test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()

    // probability = round(((mean + 1) / 2) * 100) = round(((0.5 + 1) / 2) * 100) = 75
    expect(body).toMatchObject({
      ok: true,
      stance: 0.42,
      certainty: 0.77,
      claim: 'First extracted claim', // claims[0]
      probability: 75,
    })
  })

  it('forwards the prediction\'s claimDirection/claimDeadline to getOracleForecast (arms retro #244)', async () => {
    const deadline = new Date('2026-12-31T00:00:00.000Z')
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      ...ACTIVE_PREDICTION,
      claimDirection: 'ARRIVAL',
      claimDeadline: deadline,
    } as never)
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

    await POST(post('test-secret'))

    const [, opts] = vi.mocked(getOracleForecast).mock.calls[0]
    expect(opts?.claimDirection).toBe('ARRIVAL')
    expect(opts?.claimDeadline).toBe(deadline)
  })

  it('threads the trigger article\'s gatekeeper verdict into the Oracle articles (Phase 1.3)', async () => {
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

    await POST(post('test-secret', { ...VALID_BODY, relevance: 0.83, isPrediction: true }))

    const [, opts] = vi.mocked(getOracleForecast).mock.calls[0]
    const trigger = opts?.articles?.find((a) => a.url === VALID_BODY.articleUrl)
    expect(trigger?.relevance).toBe(0.83)
    expect(trigger?.isPrediction).toBe(true)
  })

  it('omits the verdict when the push carries none (matcher fast-path)', async () => {
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

    await POST(post('test-secret'))  // VALID_BODY has no relevance/isPrediction

    const [, opts] = vi.mocked(getOracleForecast).mock.calls[0]
    expect(opts?.articles?.[0]?.relevance).toBeUndefined()
    expect(opts?.articles?.[0]?.isPrediction).toBeUndefined()
  })

  it('returns null enrichment when the Oracle has no usable forecast', async () => {
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null } as never)

    const res = await POST(post('test-secret'))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body).toMatchObject({
      ok: true,
      stance: null,
      certainty: null,
      claim: null,
      probability: null,
    })
    expect(saveNewsIndexerMatch).not.toHaveBeenCalled()
  })

  it('notifies Telegram when the Oracle produced an estimate, with the pre-push value as "previous"', async () => {
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

    await POST(post('test-secret'))
    expect(notifyNewsArticleMatched).toHaveBeenCalledTimes(1)
    const [, , , estimate] = vi.mocked(notifyNewsArticleMatched).mock.calls[0]
    // previous = the prediction's confidence BEFORE this push
    expect(estimate).toMatchObject({ probability: 75, previous: 65, ciLow: 60, ciHigh: 90 })
  })

  it('tells Telegram what the trigger article actually SAID — its stance and relevance', async () => {
    // Without these the message reports that the estimate moved but never why: a reader cannot
    // tell a decisive on-topic article from a marginal one that happened to clear the gate.
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

    await POST(post('test-secret'))
    const [, article] = vi.mocked(notifyNewsArticleMatched).mock.calls[0]
    expect(article).toMatchObject({ stance: 0.42, relevance: 0.8 })
  })

  it('passes the Oracle relevance through to news-indexer instead of dropping it', async () => {
    // The Oracle grades every article's claim-aware relevance and its SQUARE weights the article
    // in aggregation — but this route used to drop the field (exactly as it once dropped `author`),
    // so news-indexer could record THAT an article counted and never WHY.
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

    const res = await POST(post('test-secret'))
    const body = await res.json()
    expect(body.relevance).toBe(0.8)
    expect(body.sources[0]).toMatchObject({ url: 'https://bbc.com/news/x', stance: 0.42, relevance: 0.8 })
    // The estimate this push replaced — so a match reads as a movement, not a bare number.
    expect(body.previousProbability).toBe(65)
  })

  it('does NOT notify Telegram on a null-Oracle push (news-indexer retries the same set; each retry would duplicate the message)', async () => {
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null } as never)

    await POST(post('test-secret'))
    expect(notifyNewsArticleMatched).not.toHaveBeenCalled()
  })

  it('does NOT notify Telegram when the push dedups to nothing stored (a re-delivered measurement)', async () => {
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)
    vi.mocked(saveNewsIndexerMatch).mockResolvedValue({ stored: false })

    await POST(post('test-secret'))
    expect(notifyNewsArticleMatched).not.toHaveBeenCalled()
  })

  it('feeds the whole article set to the Oracle and returns per-article sources', async () => {
    const ORACLE_TWO_SOURCES = {
      ...ORACLE_WITH_SOURCE,
      articles_used: 2,
      sources: [
        ORACLE_WITH_SOURCE.sources[0],
        {
          source_id: 'aj',
          source_name: 'Al Jazeera',
          url: 'https://aljazeera.com/news/y',
          stance: -0.3,
          certainty: 0.6,
          credibility_weight: 1.0,
          claims: ['AJ claim'],
        },
      ],
    }
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_TWO_SOURCES, logId: null } as never)

    const res = await POST(
      post('test-secret', {
        predictionId: 'pred-1',
        triggerArticleUrl: 'https://aljazeera.com/news/y',
        articles: [
          { url: 'https://bbc.com/news/x', title: 'BBC', snippet: 's1', source: 'bbc.com', similarity: 0.5 },
          { url: 'https://aljazeera.com/news/y', title: 'AJ', snippet: 's2', source: 'aljazeera.com', similarity: 0.7 },
        ],
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()

    // Oracle saw both articles (aggregation, not last-write-wins).
    const [, opts] = vi.mocked(getOracleForecast).mock.calls[0]
    expect(opts?.articles).toHaveLength(2)

    // Per-article enrichment for the whole set is returned.
    expect(body.sources).toHaveLength(2)
    // Top-level echoes the *trigger* article's enrichment (the AJ one).
    expect(body).toMatchObject({ ok: true, stance: -0.3, certainty: 0.6, claim: 'AJ claim', probability: 75 })

    // The snapshot persists the full evidence set as sources.
    const [{ sources }] = vi.mocked(saveNewsIndexerMatch).mock.calls[0]
    expect(sources).toHaveLength(2)
  })

  describe('author passthrough', () => {
    // Downstream (elections.daatan.com) matches tracked commentators on
    // `oracleSnapshot.sources[].author`; the Oracle response never carries one.
    beforeEach(() => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)
    })

    const snapshotSources = (): Record<string, unknown>[] =>
      (vi.mocked(saveNewsIndexerMatch).mock.calls[0][0].oracleSnapshot as unknown as { sources: Record<string, unknown>[] })
        .sources

    it('writes the byline news-indexer holds for the article', async () => {
      vi.mocked(getArticleMetaByUrl).mockResolvedValue(
        new Map([['https://bbc.com/news/x', { requestedUrl: 'https://bbc.com/news/x', author: 'נדב איל', publishedAt: null, title: null, source: null }]]) as never,
      )

      await POST(post('test-secret'))

      expect(getArticleMetaByUrl).toHaveBeenCalledWith(['https://bbc.com/news/x'])
      expect(snapshotSources()[0]).toMatchObject({ url: 'https://bbc.com/news/x', sourceName: 'BBC', author: 'נדב איל' })
    })

    it('records a null author rather than dropping the source when no byline is indexed', async () => {
      vi.mocked(getArticleMetaByUrl).mockResolvedValue(new Map())

      await POST(post('test-secret'))

      expect(snapshotSources()).toHaveLength(1)
      expect(snapshotSources()[0]).toMatchObject({ url: 'https://bbc.com/news/x', author: null })
    })

    it('still keeps the stance/claims the snapshot carried before', async () => {
      vi.mocked(getArticleMetaByUrl).mockResolvedValue(new Map())

      await POST(post('test-secret'))

      expect(snapshotSources()[0]).toMatchObject({
        sourceId: 'bbc',
        stance: 0.42,
        certainty: 0.77,
        credibilityWeight: 1.0,
        claims: ['First extracted claim', 'Second claim'],
      })
    })
  })

  describe('the estimate is the pool aggregate, not the single-article run', () => {
    // Two pooled articles, neither of them this push's bbc.com article — so a snapshot
    // built from the pool is visibly the whole evidence set, not just what fired the push.
    const poolRow = (over: Partial<EvidencePoolArticle>): EvidencePoolArticle =>
      ({
        id: 'row',
        predictionId: 'pred-1',
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
        quantitativeEstimate: null,
        evidenceWeight: 0.6,
        relevanceScore: 0.8,
        evidenceClass: 'reported_fact',
        origin: 'news-indexer',
        excluded: false,
        addedAt: new Date('2026-07-01'),
        updatedAt: new Date('2026-07-01'),
        ...over,
      }) as EvidencePoolArticle

    const POOL_ROWS = [
      poolRow({ id: 'r1', url: 'https://reuters.com/p', source: 'reuters.com' }),
      poolRow({ id: 'r2', url: 'https://guardian.com/p', source: 'guardian.com' }),
    ]

    // The single run (ORACLE_WITH_SOURCE) means 0.5 → 75%. The pool disagrees sharply,
    // which is the whole point: one freshly-matched article must not be able to yank the
    // persisted estimate away from the body of evidence already pooled for the claim.
    const POOL: Awaited<ReturnType<typeof recomputeFromPool>> = {
      mean: -0.2, // → 40%
      std: 0.5, // → 25
      ciLow: -0.7, // → 15%
      ciHigh: 0.3, // → 65%
      articlesUsed: 2,
      settled: false,
      insufficientData: false,
      reason: null,
      poolSize: 3,
      usableSize: 2,
      excludedCount: 0,
      incompleteCount: 1,
      usableArticles: POOL_ROWS,
    }

    beforeEach(() => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)
    })

    it('persists the pool aggregate — mean, CI, std and articlesUsed all come from the pool', async () => {
      vi.mocked(recomputeFromPool).mockResolvedValue(POOL)

      await POST(post('test-secret'))

      expect(saveNewsIndexerMatch).toHaveBeenCalledWith(
        expect.objectContaining({
          externalProbability: 40, // pool's -0.2, NOT the single run's 0.5 → 75
          ciLow: 15,
          ciHigh: 65,
          oracleSnapshot: expect.objectContaining({
            mean: 40,
            std: 25,
            ciLow: 15,
            ciHigh: 65,
            articlesUsed: 2, // the pool, not this push's 1
          }),
        }),
      )
    })

    it('lists the whole usable pool in the snapshot — not just this push\'s article', async () => {
      vi.mocked(recomputeFromPool).mockResolvedValue(POOL)

      await POST(post('test-secret'))

      const snap = vi.mocked(saveNewsIndexerMatch).mock.calls[0][0].oracleSnapshot as unknown as {
        sources: { url: string; sourceName: string | null; claims: string[] }[]
      }
      // sources.length === articlesUsed: the snapshot lists exactly the articles the number averages.
      expect(snap.sources).toHaveLength(2)
      expect(snap.sources.map((s) => s.url)).toEqual(['https://reuters.com/p', 'https://guardian.com/p'])
      // and NOT the pushed bbc.com article, which the pre-PR snapshot would have shown alone.
      expect(snap.sources.map((s) => s.url)).not.toContain('https://bbc.com/news/x')
      // the pooled row's own signal is carried, not re-derived from the single run.
      expect(snap.sources[0]).toMatchObject({ sourceName: 'reuters.com', claims: ['pooled claim'] })
    })

    it('re-looks-up authors for the pooled URLs and writes them into the snapshot', async () => {
      vi.mocked(recomputeFromPool).mockResolvedValue(POOL)
      vi.mocked(getArticleMetaByUrl).mockImplementation(
        async (urls: string[]) =>
          new Map(
            urls
              .filter((u) => u === 'https://guardian.com/p')
              .map((u) => [u, { requestedUrl: u, author: 'Pool Byline', publishedAt: null, title: null, source: null }]),
          ) as never,
      )

      await POST(post('test-secret'))

      const snap = vi.mocked(saveNewsIndexerMatch).mock.calls[0][0].oracleSnapshot as unknown as {
        sources: { url: string; author: string | null }[]
      }
      const guardian = snap.sources.find((s) => s.url === 'https://guardian.com/p')
      expect(guardian?.author).toBe('Pool Byline')
      // a pooled URL news-indexer has no byline for is kept with a null author, never dropped.
      expect(snap.sources.find((s) => s.url === 'https://reuters.com/p')?.author).toBeNull()
    })

    it('pools this push\'s articles BEFORE aggregating, so they count toward their own estimate', async () => {
      const order: string[] = []
      vi.mocked(addArticlesToPool).mockImplementation(async () => {
        order.push('add')
      })
      vi.mocked(recomputeFromPool).mockImplementation(async () => {
        order.push('recompute')
        return POOL
      })

      await POST(post('test-secret'))

      expect(addArticlesToPool).toHaveBeenCalledWith('pred-1', expect.any(Array), 'news-indexer')
      expect(order).toEqual(['add', 'recompute'])
    })

    it('forwards claimDirection/claimDeadline to the recompute', async () => {
      const deadline = new Date('2026-12-31T00:00:00.000Z')
      vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
        ...ACTIVE_PREDICTION,
        claimDirection: 'ARRIVAL',
        claimDeadline: deadline,
      } as never)
      vi.mocked(recomputeFromPool).mockResolvedValue(POOL)

      await POST(post('test-secret'))

      expect(recomputeFromPool).toHaveBeenCalledWith('pred-1', 'ARRIVAL', deadline)
    })

    it('carries the pool\'s settlement verdict, not the single run\'s', async () => {
      vi.mocked(recomputeFromPool).mockResolvedValue({ ...POOL, settled: true })

      await POST(post('test-secret'))

      expect(saveNewsIndexerMatch).toHaveBeenCalledWith(expect.objectContaining({ settled: true }))
    })

    // ── fallbacks: never drop an estimate just because the pool could not produce one ──

    it('falls back to the single run when the pool cannot aggregate at all', async () => {
      vi.mocked(recomputeFromPool).mockResolvedValue(null)

      await POST(post('test-secret'))

      expect(saveNewsIndexerMatch).toHaveBeenCalledWith(
        expect.objectContaining({
          externalProbability: 75, // the single run's 0.5
          oracleSnapshot: expect.objectContaining({ articlesUsed: 1 }),
        }),
      )
    })

    it('ABSTAINS (no number, no notify) when the pool is off-topic — does NOT fall back to the single run', async () => {
      vi.mocked(recomputeFromPool).mockResolvedValue({
        ...POOL,
        insufficientData: true,
        reason: 'all_articles_off_topic',
      })

      const res = await POST(post('test-secret'))

      // records an abstention, NOT the single run's 75
      expect(saveNewsIndexerMatch).toHaveBeenCalledWith(
        expect.objectContaining({
          externalProbability: null,
          ciLow: null,
          ciHigh: null,
          insufficientData: true,
          oracleSnapshot: expect.objectContaining({ insufficient: true, reason: 'all_articles_off_topic' }),
        }),
      )
      // no high-confidence notification fires on an abstention
      expect(notifyNewsArticleMatched).not.toHaveBeenCalled()
      // the response carries no probability
      expect((await res.json()).probability).toBeNull()
    })

    it('still persists an estimate when the pool write/recompute throws', async () => {
      vi.mocked(addArticlesToPool).mockRejectedValue(new Error('pool down'))

      await POST(post('test-secret'))

      expect(saveNewsIndexerMatch).toHaveBeenCalledWith(expect.objectContaining({ externalProbability: 75 }))
    })

    it('does not touch the pool when the Oracle returns no usable forecast', async () => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null } as never)

      await POST(post('test-secret'))

      expect(addArticlesToPool).not.toHaveBeenCalled()
      expect(recomputeFromPool).not.toHaveBeenCalled()
    })
  })

  describe('extraction claim gate (evidence-pool.ts) — fixes the confirmed near-instant duplicate-write race', () => {
    it('skips the Oracle call entirely when every article is already claimed/unchanged', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue(['skip'])

      const res = await POST(post('test-secret'))
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(getOracleForecast).not.toHaveBeenCalled()
      expect(saveNewsIndexerMatch).not.toHaveBeenCalled()
      expect(notifyNewsArticleMatched).not.toHaveBeenCalled()
      expect(body).toMatchObject({ ok: true, probability: null, skipped: 'unchanged' })
    })

    it('proceeds to call the Oracle when at least one article in a multi-article push is newly claimed', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue(['skip', 'claimed'])
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

      const res = await POST(post('test-secret'))
      expect(res.status).toBe(200)
      expect(getOracleForecast).toHaveBeenCalledTimes(1)
    })

    it('claims each article in the push with its url/title/snippet, keyed to this prediction', async () => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

      await POST(post('test-secret'))

      expect(claimArticlesForExtraction).toHaveBeenCalledWith(
        'pred-1',
        [
          expect.objectContaining({ url: 'https://bbc.com/news/x', title: 'Headline', snippet: 'A snippet.' }),
        ],
        'news-indexer',
      )
    })

    it('releases the claim (status=FAILED) when the Oracle call itself throws, and rethrows', async () => {
      vi.mocked(getOracleForecast).mockRejectedValue(new Error('oracle timeout'))

      const res = await POST(post('test-secret'))

      expect(res.status).toBe(500)
      expect(failClaimedArticles).toHaveBeenCalledWith('pred-1', ['https://bbc.com/news/x'], 'extractor_error')
    })

    it('releases the claim when the Oracle returns no usable forecast, so the next push can retry immediately', async () => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null } as never)

      await POST(post('test-secret'))

      expect(failClaimedArticles).toHaveBeenCalledWith('pred-1', ['https://bbc.com/news/x'], 'oracle_null')
    })

    it('releases claims the Oracle omitted after pooling — a gatekeeper-rejected article must not stay PENDING forever', async () => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

      await POST(post('test-secret'))

      // Called with everything this run claimed; failClaimedArticles' own PENDING
      // filter subtracts what addArticlesToPool already flipped to COMPLETE.
      expect(failClaimedArticles).toHaveBeenCalledWith('pred-1', ['https://bbc.com/news/x'], 'oracle_omitted')
    })

    it('scopes the omitted-claims release to what THIS run claimed — a skipped article stays with its owner', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue(['skip', 'claimed'])
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            { url: 'https://a.com/1', title: 'A', snippet: 's' },
            { url: 'https://b.com/2', title: 'B', snippet: 's' },
          ],
        }),
      )

      expect(failClaimedArticles).toHaveBeenCalledWith('pred-1', ['https://b.com/2'], 'oracle_omitted')
    })
  })
})
