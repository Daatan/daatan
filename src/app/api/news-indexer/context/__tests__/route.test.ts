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
  prisma: { prediction: { findUnique: vi.fn() }, evidencePoolArticle: { findUnique: vi.fn() } },
}))

// `isTransportNullReason` is taken from the REAL module, not stubbed: it encodes
// which failure classes are recoverable, and a hand-copied predicate here would keep
// passing after that set changed. Only the network call is replaced.
vi.mock('@/lib/services/oracle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/oracle')>()),
  getOracleForecast: vi.fn(),
}))
vi.mock('@/lib/services/oracle-backfill', () => ({ scheduleOracleReask: vi.fn() }))
vi.mock('@/lib/services/context', () => ({ saveNewsIndexerMatch: vi.fn(), getLatestOracleSnapshot: vi.fn() }))
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
import { scheduleOracleReask } from '@/lib/services/oracle-backfill'
import { saveNewsIndexerMatch, getLatestOracleSnapshot } from '@/lib/services/context'
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
    vi.mocked(prisma.evidencePoolArticle.findUnique).mockResolvedValue(null as never)
    vi.mocked(saveNewsIndexerMatch).mockResolvedValue({ stored: true, contextSnapshotId: 'snap-1' })
    vi.mocked(getArticleMetaByUrl).mockResolvedValue(new Map())
    vi.mocked(addArticlesToPool).mockResolvedValue(undefined)
    // Default: no pool aggregate available, so the route falls back to the single-run
    // forecast. That is what every test outside the pool block below asserts against.
    vi.mocked(recomputeFromPool).mockResolvedValue(null)
    // Default: no prior evidence snapshot, so every pooled source in the pool-block tests
    // below is (correctly) not carried-forward.
    vi.mocked(getLatestOracleSnapshot).mockResolvedValue(null as never)
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
    const [, article, match] = vi.mocked(notifyNewsArticleMatched).mock.calls[0]
    expect(article).toMatchObject({ stance: 0.42, certainty: 0.77, relevance: 0.8 })
    // Single-run fallback (the beforeEach default): no pool behind the estimate.
    expect(match).toMatchObject({ poolSize: null })
  })

  it('passes the Oracle-extracted claim as the article extract, falling back to the snippet', async () => {
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

    await POST(post('test-secret'))
    const [, article] = vi.mocked(notifyNewsArticleMatched).mock.calls[0]
    expect(article).toMatchObject({ extract: 'First extracted claim' })

    // No extracted claim → the raw snippet stands in.
    vi.mocked(notifyNewsArticleMatched).mockClear()
    vi.mocked(getOracleForecast).mockResolvedValue({
      forecast: { ...ORACLE_WITH_SOURCE, sources: [{ ...ORACLE_WITH_SOURCE.sources[0], claims: [] }] },
      logId: null,
    } as never)
    await POST(post('test-secret'))
    expect(vi.mocked(notifyNewsArticleMatched).mock.calls[0][1]).toMatchObject({ extract: 'A snippet.' })
  })

  it('threads the trigger pool row into the notify call so rating buttons attach (daatan#1223)', async () => {
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)
    vi.mocked(prisma.evidencePoolArticle.findUnique).mockResolvedValue({ id: 'epa-1' } as EvidencePoolArticle)

    await POST(post('test-secret'))
    expect(vi.mocked(notifyNewsArticleMatched).mock.calls[0][4]).toEqual({
      evidencePoolArticleId: 'epa-1',
      contextSnapshotId: 'snap-1',
    })
  })

  it('passes a null rating arg when the trigger pool row could not be resolved', async () => {
    // The beforeEach default: evidencePoolArticle.findUnique resolves null.
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

    await POST(post('test-secret'))
    expect(vi.mocked(notifyNewsArticleMatched).mock.calls[0][4]).toBeNull()
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
    vi.mocked(saveNewsIndexerMatch).mockResolvedValue({ stored: false, contextSnapshotId: 'snap-1' })

    await POST(post('test-secret'))
    expect(notifyNewsArticleMatched).not.toHaveBeenCalled()
  })

  it('feeds the whole article set to the Oracle and returns per-article sources', async () => {
    // Both articles are newly claimed — matches the 2-article request below.
    // The beforeEach default (a single 'claimed') is for the single-article
    // VALID_BODY most other tests send.
    vi.mocked(claimArticlesForExtraction).mockResolvedValue(['claimed', 'claimed'])
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

  it('reports NO top-level signal when the Oracle omitted the trigger article (daatan#1252)', async () => {
    // The trigger is dropped by the Oracle (gate-rejected / extraction failed) while a neighbour
    // in the same evidence set survives. news-indexer writes these top-level fields into
    // forecast_match FOR THE TRIGGER, under the trigger's person_id, and that row feeds
    // source_accuracy and the public by-source panel — so echoing the neighbour's numbers here
    // credits one author with another's claim. Only reachable at PUSH_EVIDENCE_COUNT > 1, which
    // production runs (8).
    vi.mocked(claimArticlesForExtraction).mockResolvedValue(['claimed', 'claimed'])
    vi.mocked(getOracleForecast).mockResolvedValue({
      // Only the BBC (non-trigger) article comes back; the AJ trigger is absent.
      forecast: { ...ORACLE_WITH_SOURCE, articles_used: 1, sources: [ORACLE_WITH_SOURCE.sources[0]] },
      logId: null,
    } as never)

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

    // Null, NOT the surviving neighbour's signal.
    expect(body).toMatchObject({ ok: true, stance: null, certainty: null, claim: null, relevance: null })
    // The neighbour is still reported in its own right, under its own url.
    expect(body.sources).toHaveLength(1)
    expect(body.sources[0]).toMatchObject({ url: 'https://bbc.com/news/x' })
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
      const createdAt = new Date('2026-07-04T10:00:00.000Z')
      vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
        ...ACTIVE_PREDICTION,
        claimDirection: 'ARRIVAL',
        claimDeadline: deadline,
        createdAt,
        claimArchetype: 'SCHEDULED',
      } as never)
      vi.mocked(recomputeFromPool).mockResolvedValue(POOL)

      await POST(post('test-secret'))

      // claimText rides along so the settlement match gate can run on this path
      // (daatan#1264) — without it retro skips with `reason=no_question`.
      expect(recomputeFromPool).toHaveBeenCalledWith('pred-1', 'ARRIVAL', deadline, createdAt, 'SCHEDULED', 'Will X happen?')
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

    it('only sends newly-claimed articles to the Oracle — an unchanged article must not be re-extracted (daatan#1172)', async () => {
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

      expect(getOracleForecast).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          articles: [expect.objectContaining({ url: 'https://b.com/2' })],
        }),
        expect.anything(),
      )
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

    // The `extractor_error` test that used to sit here is gone with the branch it covered
    // (daatan#1231). It asserted a throw from `getOracleForecast` released the claim and
    // returned 500 — but `getOracleForecast` cannot throw: `getOracleConfig` is a pure env
    // read, every network/parse path is inside its own try, and the catch's only await
    // (`logOracleCall`) swallows its own errors. The mock could do what the real function
    // cannot. That invariant is pinned directly in oracle.test.ts → "never rejects".

    it('forwards the pre-fetched article body to the Oracle', async () => {
      // news-indexer#201 / daatan#1255. `z.object().parse()` STRIPS unknown keys, so before this
      // the body was dropped silently at the boundary — news-indexer could have been sending it
      // for months with no error anywhere and no effect. The Oracle has always accepted
      // `ArticleInput.text` ("if omitted, oracle fetches via trafilatura"); daatan was the
      // missing link. Measured: 1.5% of 88,033 Oracle article reads were pre-fetched, 19.0%
      // fell through to the extractor running over title+snippet.
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_abstain' } as never)

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [{ url: 'https://a.com/1', title: 'A', snippet: 's', text: 'the archived body' }],
        }),
      )

      const sent = vi.mocked(getOracleForecast).mock.calls[0][1]!.articles!
      expect(sent[0].text).toBe('the archived body')
    })

    it('accepts the body on the legacy single-article shape too', async () => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_abstain' } as never)

      await POST(post('test-secret', { ...VALID_BODY, articleText: 'legacy body' }))

      expect(vi.mocked(getOracleForecast).mock.calls[0][1]!.articles![0].text).toBe('legacy body')
    })

    it('leaves the body undefined when none is sent, so nothing changes for an unarchived article', async () => {
      // The inert case, and it is the ONLY case until news-indexer's PUSH_ARTICLE_TEXT is on.
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_abstain' } as never)

      await POST(post('test-secret'))

      expect(vi.mocked(getOracleForecast).mock.calls[0][1]!.articles![0].text).toBeUndefined()
    })

    it('truncates a body over the Oracle\'s truncation point instead of dropping the push', async () => {
      // daatan#1278. This used to be a schema `.max()`, which rejected the WHOLE request — so one
      // over-long article killed an 8-article push, including the seven that were fine, over a
      // field whose entire contract is "absent means fetch it yourself".
      vi.mocked(claimArticlesForExtraction).mockResolvedValue(['claimed', 'claimed'])
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_abstain' } as never)

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            { url: 'https://a.com/1', title: 'A', snippet: 's', text: 'x'.repeat(4001) },
            { url: 'https://a.com/2', title: 'B', snippet: 's', text: 'a good body' },
          ],
        }),
      )

      const sent = vi.mocked(getOracleForecast).mock.calls[0][1]!.articles!
      expect(sent[0].text).toHaveLength(4000)
      // The innocent neighbour still arrives — that is the whole point of the change.
      expect(sent[1].text).toBe('a good body')
    })

    it('survives an emoji body that a code-point-capping producer considers in bounds', async () => {
      // The exact prod failure (news-indexer#207): news-indexer caps with Python's `t[:4000]`,
      // which counts CODE POINTS, while JS `.length` counts UTF-16 units — an emoji is 1 there
      // and 2 here. So a body news-indexer measured at 4,000 arrived measuring 8,000 and the
      // `.max(4000)` 400'd the entire push on its first live payload.
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_abstain' } as never)

      const inBoundsForPython = '😀'.repeat(4000) // 4,000 code points, 8,000 UTF-16 units

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [{ url: 'https://a.com/1', title: 'A', snippet: 's', text: inBoundsForPython }],
        }),
      )

      expect(getOracleForecast).toHaveBeenCalled()
      expect(vi.mocked(getOracleForecast).mock.calls[0][1]!.articles![0].text!.length).toBeLessThanOrEqual(4000)
    })

    it('stamps the Oracle failure CLASS on the released claims, not a blanket oracle_null', async () => {
      // The measured problem: a 12s client timeout and a deliberate abstention wrote
      // byte-identical pool rows, so 73% of recent fetches carried one uninformative
      // string and the retry sweep could not tell "not worth re-asking" from "never got
      // an answer". The cause now lands where the sweep can read it.
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_timeout' } as never)

      await POST(post('test-secret'))

      expect(failClaimedArticles).toHaveBeenCalledWith('pred-1', ['https://bbc.com/news/x'], 'oracle_timeout')
    })

    it('goes back for a forecast we hung up on, with the EXACT set we sent', async () => {
      // daatan#1262. retro does not cancel on client disconnect — it finishes the run
      // and holds it in `forecast_cache` for an hour, while daatan's earliest re-ask was
      // 24h, so the entry always expired unread. The re-ask must carry the set that was
      // actually SENT (the claimed subset), because retro keys its cache on the sorted
      // URL set: a set that merely overlaps is a different key and re-runs the extractor.
      vi.mocked(claimArticlesForExtraction).mockResolvedValue(['skip', 'claimed'])
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_timeout' } as never)

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            { url: 'https://a.com/1', title: 'A', snippet: 'sa' },  // already claimed elsewhere — never sent
            { url: 'https://b.com/2', title: 'B', snippet: 'sb' },  // ours
          ],
        }),
      )

      expect(scheduleOracleReask).toHaveBeenCalledTimes(1)
      const [, articles, origin] = vi.mocked(scheduleOracleReask).mock.calls[0]
      // Set equality with what the extractor was handed — this is the cache key.
      expect(articles.map((a) => a.url)).toEqual(
        vi.mocked(getOracleForecast).mock.calls[0][1]!.articles!.map((a) => a.url),
      )
      expect(articles.map((a) => a.url)).toEqual(['https://b.com/2'])
      expect(articles[0]).toMatchObject({ title: 'B', snippet: 'sb' })
      expect(origin).toBe('news-indexer')
    })

    it('does NOT re-ask when the Oracle actually answered and declined', async () => {
      // `oracle_abstain` is a verdict about the articles: the run completed, so there is
      // no abandoned result to collect and re-asking with the same set buys the same
      // answer at full price. Only the transport classes leave work behind.
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_abstain' } as never)

      await POST(post('test-secret'))

      expect(scheduleOracleReask).not.toHaveBeenCalled()
    })

    it('does NOT re-ask on an unclassified null', async () => {
      // Legacy `oracle_null` conflates all six causes, so it is not evidence that a run
      // completed — same reasoning that keeps it out of ATTRIBUTABLE_NULL_REASONS.
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null } as never)

      await POST(post('test-secret'))

      expect(scheduleOracleReask).not.toHaveBeenCalled()
    })

    it('does NOT re-ask when the Oracle returned a usable forecast', async () => {
      vi.mocked(getOracleForecast).mockResolvedValue({
        forecast: { mean: 0.4, std: 0.1, ci_low: 0.2, ci_high: 0.6, articles_used: 1, sources: [], placeholder: false },
        logId: null,
      } as never)

      await POST(post('test-secret'))

      expect(scheduleOracleReask).not.toHaveBeenCalled()
    })

    it('fails only THIS request\'s claims on a null forecast, never a concurrent run\'s', async () => {
      // daatan#1232. The null path passed the whole pushed set unfiltered, while the
      // success path 130 lines above scopes to `claimResults[i] === 'claimed'`.
      // `failClaimedArticles` only touches PENDING rows — and a concurrent request's
      // fresh, still-extracting claim is exactly that. So a null here marked another
      // in-flight request's article FAILED underneath it.
      vi.mocked(claimArticlesForExtraction).mockResolvedValue(['skip', 'claimed'])
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_abstain' } as never)

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            { url: 'https://a.com/1', title: 'A', snippet: 's' },  // another run's claim
            { url: 'https://b.com/2', title: 'B', snippet: 's' },  // ours
          ],
        }),
      )

      const urls = vi.mocked(failClaimedArticles).mock.calls[0][1]
      expect(urls).toEqual(['https://b.com/2'])
      expect(urls).not.toContain('https://a.com/1')
    })

    it('falls back to oracle_null when no class is supplied, so claims are always released', async () => {
      // Belt and braces: an unclassified null is unreachable today (every branch sets a
      // class, pinned in oracle.test.ts), but releasing the claim must never depend on
      // that — a claim left PENDING blocks the article for the full staleness window.
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
