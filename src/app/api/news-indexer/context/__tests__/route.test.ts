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
vi.mock('@/lib/services/evidence-pool', async (importOriginal) => ({
  // `articleIdsByUrl` is taken from the REAL module — it's a pure function whose
  // contract (skip a URL whose outcome carries a null articleId) the route depends
  // on, and a hand-copied stub here would keep passing after that contract changed.
  ...(await importOriginal<typeof import('@/lib/services/evidence-pool')>()),
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
    vi.mocked(claimArticlesForExtraction).mockResolvedValue([{ result: 'claimed', articleId: 'row-1' }])
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

  it('forwards the prediction\'s resolutionRules to getOracleForecast (daatan#1375)', async () => {
    vi.mocked(prisma.prediction.findUnique).mockResolvedValue({
      ...ACTIVE_PREDICTION,
      resolutionRules: 'Only an official government announcement counts.',
    } as never)
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

    await POST(post('test-secret'))

    const [, opts] = vi.mocked(getOracleForecast).mock.calls[0]
    expect(opts?.resolutionRules).toBe('Only an official government announcement counts.')
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
    // The claim step already resolved the trigger article's row id (daatan#1381) — no
    // separate findUnique lookup exists anymore, so the id comes straight off the claim.
    vi.mocked(claimArticlesForExtraction).mockResolvedValue([{ result: 'claimed', articleId: 'epa-1' }])
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

    await POST(post('test-secret'))
    expect(vi.mocked(notifyNewsArticleMatched).mock.calls[0][4]).toEqual({
      evidencePoolArticleId: 'epa-1',
      contextSnapshotId: 'snap-1',
    })
  })

  it('passes a null rating arg when the trigger pool row could not be resolved', async () => {
    // A lost versioning race (daatan#1381) — result 'skip' with a null articleId. On its
    // own that article would take the early "all unchanged" return, so pair it with a
    // second, genuinely-claimed article to reach the notify block at all; the trigger is
    // the one that lost the race, which is exactly what's under test here.
    vi.mocked(claimArticlesForExtraction).mockResolvedValue([
      { result: 'claimed', articleId: 'row-bbc' },
      { result: 'skip_pending', articleId: null },
    ])
    vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

    await POST(
      post('test-secret', {
        predictionId: 'pred-1',
        triggerArticleUrl: 'https://aljazeera.com/news/y',
        articles: [
          { url: 'https://bbc.com/news/x', title: 'BBC', snippet: 's1', source: 'bbc.com', similarity: 0.5 },
          { url: 'https://aljazeera.com/news/y', title: 'AJ', snippet: 's2', source: 'aljazeera.com', similarity: 0.7 },
        ],
      }),
    )
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
    vi.mocked(claimArticlesForExtraction).mockResolvedValue([
      { result: 'claimed', articleId: 'row-1' },
      { result: 'claimed', articleId: 'row-2' },
    ])
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
    vi.mocked(claimArticlesForExtraction).mockResolvedValue([
      { result: 'claimed', articleId: 'row-1' },
      { result: 'claimed', articleId: 'row-2' },
    ])
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

  describe('personId/outletId passthrough (daatan#1349/#1463)', () => {
    // Pins two contracts. (1) news-indexer sends `personId`/`outletId` (worker/matcher.py) but
    // the schema didn't declare them, so Zod's `.parse()` silently stripped them as unknown
    // keys — if the schema regresses to stripping these again, this suite fails loudly instead
    // of the field just silently vanishing. (2) The push carries ids ONLY — never names or
    // `author`, so the by-url lookup must run for every such URL (daatan#1463: skipping it
    // for push-identified articles left names/author permanently NULL); push ids still win
    // over the lookup's, and a lookup name is never attached to a different push-supplied id.
    // A NEWER news-indexer does send names — that path is the news-indexer#302 suite below.
    beforeEach(() => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)
    })

    const snapshotSources = (): Record<string, unknown>[] =>
      (vi.mocked(saveNewsIndexerMatch).mock.calls[0][0].oracleSnapshot as unknown as { sources: Record<string, unknown>[] })
        .sources

    it('accepts personId/outletId inside articles[] and writes them into the snapshot', async () => {
      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            {
              url: 'https://bbc.com/news/x',
              title: 'Headline',
              snippet: 's',
              personId: 'person-1',
              outletId: 'outlet-1',
            },
          ],
        }),
      )

      expect(snapshotSources()[0]).toMatchObject({
        url: 'https://bbc.com/news/x',
        personId: 'person-1',
        outletId: 'outlet-1',
      })
    })

    it('accepts personId/outletId on the legacy single-article body shape', async () => {
      await POST(post('test-secret', { ...VALID_BODY, personId: 'person-2', outletId: 'outlet-2' }))

      expect(snapshotSources()[0]).toMatchObject({ personId: 'person-2', outletId: 'outlet-2' })
    })

    it('calls the by-url lookup even when every article carries identity from the push, and takes names/author from it while the push ids win', async () => {
      // daatan#1463: the push carries ids only, so skipping the lookup here left every
      // pool row's person_name/outlet_name/author NULL forever.
      vi.mocked(getArticleMetaByUrl).mockResolvedValue(
        new Map([
          [
            'https://bbc.com/news/x',
            {
              requestedUrl: 'https://bbc.com/news/x',
              author: 'BBC Byline',
              publishedAt: null,
              title: null,
              source: null,
              personId: 'person-1',
              personName: 'Person One',
              outletId: 'outlet-1',
              outletName: 'Outlet One',
            },
          ],
        ]) as never,
      )

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            {
              url: 'https://bbc.com/news/x',
              title: 'Headline',
              snippet: 's',
              personId: 'person-1',
              outletId: 'outlet-1',
            },
          ],
        }),
      )

      expect(getArticleMetaByUrl).toHaveBeenCalledWith(['https://bbc.com/news/x'])
      expect(snapshotSources()[0]).toMatchObject({
        personId: 'person-1',
        personName: 'Person One',
        outletId: 'outlet-1',
        outletName: 'Outlet One',
        author: 'BBC Byline',
      })
    })

    it('looks up BOTH urls; push ids still win for the article the push identified', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([
      { result: 'claimed', articleId: 'row-1' },
      { result: 'claimed', articleId: 'row-2' },
    ])
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
      vi.mocked(getArticleMetaByUrl).mockResolvedValue(
        new Map([
          [
            'https://aljazeera.com/news/y',
            {
              requestedUrl: 'https://aljazeera.com/news/y',
              author: 'AJ Byline',
              publishedAt: null,
              title: null,
              source: null,
              personId: 'person-looked-up',
              personName: 'Looked Up Person',
              outletId: 'outlet-looked-up',
              outletName: 'Looked Up Outlet',
            },
          ],
        ]) as never,
      )

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            // Identified by the push — the id wins, but the URL is still looked up (names/author).
            { url: 'https://bbc.com/news/x', title: 'BBC', snippet: 's1', personId: 'person-1' },
            // NOT identified by the push — identity comes entirely from the lookup.
            { url: 'https://aljazeera.com/news/y', title: 'AJ', snippet: 's2' },
          ],
        }),
      )

      expect(getArticleMetaByUrl).toHaveBeenCalledWith([
        'https://bbc.com/news/x',
        'https://aljazeera.com/news/y',
      ])

      const sources = snapshotSources()
      const bbc = sources.find((s) => s.url === 'https://bbc.com/news/x')
      const aj = sources.find((s) => s.url === 'https://aljazeera.com/news/y')
      expect(bbc).toMatchObject({ personId: 'person-1' })
      expect(aj).toMatchObject({ personId: 'person-looked-up', personName: 'Looked Up Person', outletId: 'outlet-looked-up' })
    })

    it('leaves names undefined and author null on a lookup miss, keeping the push-supplied id', async () => {
      // personName/outletName are not in the push payload at all — only ids. When the by-url
      // lookup misses (timeout/unknown URL), a push-identified article must leave
      // personName/outletName `undefined` (no opinion this run), not `null` (a real "resolved
      // to nothing" signal) — see the F11 undefined-vs-null convention. `author` IS null: the
      // authorByUrl map resolved nothing and the snapshot records that explicitly.
      vi.mocked(getArticleMetaByUrl).mockResolvedValue(new Map())

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            { url: 'https://bbc.com/news/x', title: 'Headline', snippet: 's', personId: 'person-1' },
          ],
        }),
      )

      const source = snapshotSources()[0]
      expect(source.personId).toBe('person-1')
      expect(source.personName).toBeUndefined()
      expect(source.outletName).toBeUndefined()
      expect(source.author).toBeNull()
    })

    it('never staples a lookup name onto a different push-supplied id', async () => {
      // Push and lookup disagree on WHO wrote the article. The push id is authoritative
      // (#1361's surviving intent), so the lookup's name — which describes the LOSING id —
      // must not be attached to it. The author byline is raw text, not tied to an id: it
      // still comes from the lookup.
      vi.mocked(getArticleMetaByUrl).mockResolvedValue(
        new Map([
          [
            'https://bbc.com/news/x',
            {
              requestedUrl: 'https://bbc.com/news/x',
              author: 'Some Byline',
              publishedAt: null,
              title: null,
              source: null,
              personId: 'person-looked-up',
              personName: 'Looked Up Person',
            },
          ],
        ]) as never,
      )

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            { url: 'https://bbc.com/news/x', title: 'Headline', snippet: 's', personId: 'person-push' },
          ],
        }),
      )

      const source = snapshotSources()[0]
      expect(source.personId).toBe('person-push')
      expect(source.personName).toBeUndefined()
      expect(source.author).toBe('Some Byline')
    })

    it('fills personId/personName from the lookup for an outlet-only push item', async () => {
      // The push resolved the outlet but not the person; the lookup knows the person.
      // Each dimension merges independently: outletId stays the push's, person comes
      // whole (id + name) from the lookup.
      vi.mocked(getArticleMetaByUrl).mockResolvedValue(
        new Map([
          [
            'https://bbc.com/news/x',
            {
              requestedUrl: 'https://bbc.com/news/x',
              author: 'BBC Byline',
              publishedAt: null,
              title: null,
              source: null,
              personId: 'person-looked-up',
              personName: 'Looked Up Person',
            },
          ],
        ]) as never,
      )

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            { url: 'https://bbc.com/news/x', title: 'Headline', snippet: 's', outletId: 'outlet-push' },
          ],
        }),
      )

      const source = snapshotSources()[0]
      expect(source.outletId).toBe('outlet-push')
      expect(source.personId).toBe('person-looked-up')
      expect(source.personName).toBe('Looked Up Person')
    })
  })

  describe('push-supplied personName/outletName/author (news-indexer#302)', () => {
    // news-indexer already resolved the identity it pushed the ids for, so since ni#302 it
    // sends the NAMES alongside them. Presence — not truthiness — is the discriminator:
    // `author === undefined` means an older news-indexer that never sent these fields and the
    // by-url lookup still has to run; `null` means it resolved no byline and is authoritative.
    // Collapsing the two would re-derive by DB round-trip exactly what we were just handed,
    // which is the per-push latency daatan#1463 had to give back to fix the NULL-names bug.
    beforeEach(() => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)
    })

    const snapshotSources = (): Record<string, unknown>[] =>
      (vi.mocked(saveNewsIndexerMatch).mock.calls[0][0].oracleSnapshot as unknown as { sources: Record<string, unknown>[] })
        .sources

    it('takes names and byline from the push and skips the lookup entirely', async () => {
      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            {
              url: 'https://bbc.com/news/x',
              title: 'Headline',
              snippet: 's',
              personId: 'person-1',
              personName: 'Person One',
              outletId: 'outlet-1',
              outletName: 'Outlet One',
              author: 'BBC Byline',
            },
          ],
        }),
      )

      expect(getArticleMetaByUrl).toHaveBeenCalledWith([])
      expect(snapshotSources()[0]).toMatchObject({
        personId: 'person-1',
        personName: 'Person One',
        outletId: 'outlet-1',
        outletName: 'Outlet One',
        author: 'BBC Byline',
      })
    })

    it('honours an explicit null byline instead of looking one up', async () => {
      // news-indexer resolved no byline for this article. That is an answer, not a gap:
      // re-running the lookup could only return the same NULL from the same row.
      vi.mocked(getArticleMetaByUrl).mockResolvedValue(
        new Map([
          [
            'https://bbc.com/news/x',
            {
              requestedUrl: 'https://bbc.com/news/x',
              author: 'Should Not Be Used',
              publishedAt: null,
              title: null,
              source: null,
              personId: 'person-looked-up',
              personName: 'Looked Up Person',
            },
          ],
        ]) as never,
      )

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            { url: 'https://bbc.com/news/x', title: 'Headline', snippet: 's', author: null },
          ],
        }),
      )

      expect(getArticleMetaByUrl).toHaveBeenCalledWith([])
      expect(snapshotSources()[0].author).toBeNull()
    })

    it('looks up only the urls the push did not cover', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([
        { result: 'claimed', articleId: 'row-1' },
        { result: 'claimed', articleId: 'row-2' },
      ])
      vi.mocked(getOracleForecast).mockResolvedValue({
        forecast: {
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
        },
        logId: null,
      } as never)
      vi.mocked(getArticleMetaByUrl).mockResolvedValue(
        new Map([
          [
            'https://aljazeera.com/news/y',
            {
              requestedUrl: 'https://aljazeera.com/news/y',
              author: 'AJ Byline',
              publishedAt: null,
              title: null,
              source: null,
              personId: 'person-looked-up',
              personName: 'Looked Up Person',
            },
          ],
        ]) as never,
      )

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            // Carries its own identity — nothing left to look up.
            {
              url: 'https://bbc.com/news/x',
              title: 'BBC',
              snippet: 's1',
              personId: 'person-1',
              personName: 'Person One',
              author: 'BBC Byline',
            },
            // Older-shaped item (no `author` key at all) — still needs the lookup.
            { url: 'https://aljazeera.com/news/y', title: 'AJ', snippet: 's2' },
          ],
        }),
      )

      expect(getArticleMetaByUrl).toHaveBeenCalledWith(['https://aljazeera.com/news/y'])

      const sources = snapshotSources()
      expect(sources.find((s) => s.url === 'https://bbc.com/news/x')).toMatchObject({
        personId: 'person-1',
        personName: 'Person One',
        author: 'BBC Byline',
      })
      expect(sources.find((s) => s.url === 'https://aljazeera.com/news/y')).toMatchObject({
        personId: 'person-looked-up',
        personName: 'Looked Up Person',
        author: 'AJ Byline',
      })
    })

    it('ignores a pushed name whose id the push did not supply', async () => {
      // A name without its id cannot be attached to anything: the id that wins here is the
      // lookup's, so the lookup's name is the one that describes it.
      vi.mocked(getArticleMetaByUrl).mockResolvedValue(
        new Map([
          [
            'https://bbc.com/news/x',
            {
              requestedUrl: 'https://bbc.com/news/x',
              author: 'BBC Byline',
              publishedAt: null,
              title: null,
              source: null,
              personId: 'person-looked-up',
              personName: 'Looked Up Person',
            },
          ],
        ]) as never,
      )

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [
            // `personName` with no `personId`, and no `author` key, so the lookup still runs.
            { url: 'https://bbc.com/news/x', title: 'Headline', snippet: 's', personName: 'Orphan Name' },
          ],
        }),
      )

      expect(getArticleMetaByUrl).toHaveBeenCalledWith(['https://bbc.com/news/x'])
      expect(snapshotSources()[0]).toMatchObject({
        personId: 'person-looked-up',
        personName: 'Looked Up Person',
      })
    })

    it('carries the names through the legacy single-article body shape', async () => {
      await POST(
        post('test-secret', {
          ...VALID_BODY,
          personId: 'person-2',
          personName: 'Person Two',
          outletId: 'outlet-2',
          outletName: 'Outlet Two',
          author: 'Legacy Byline',
        }),
      )

      expect(getArticleMetaByUrl).toHaveBeenCalledWith([])
      expect(snapshotSources()[0]).toMatchObject({
        personId: 'person-2',
        personName: 'Person Two',
        outletId: 'outlet-2',
        outletName: 'Outlet Two',
        author: 'Legacy Byline',
      })
    })

    it('still looks up a legacy body that carries no identity fields', async () => {
      // The normalization must not turn "absent" into `null` on its way to items[] — that
      // would read as an authoritative "no byline" and permanently skip the lookup.
      await POST(post('test-secret', VALID_BODY))

      expect(getArticleMetaByUrl).toHaveBeenCalledWith(['https://bbc.com/news/x'])
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
      evidenceMass: null,
      nEff: null,
      ageAdjustedMass: null,
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

    it('tells Telegram how much of the pool was readable, not just how big it is (daatan#1475)', async () => {
      // 3 rows pooled, 2 usable — the header must not imply the number rests on all three.
      vi.mocked(recomputeFromPool).mockResolvedValue(POOL)

      await POST(post('test-secret'))

      const [, , match] = vi.mocked(notifyNewsArticleMatched).mock.calls[0]
      expect(match).toMatchObject({ poolSize: 3, usableSize: 2 })
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

      expect(addArticlesToPool).toHaveBeenCalledWith('pred-1', expect.any(Array), 'news-indexer', expect.any(Map))
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
          // daatan#1473: the reason is what decides whether this abstention may clear the
          // published estimate, and it is persisted so the abstention stays diagnosable.
          insufficientReason: 'all_articles_off_topic',
          poolSize: 3,
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

  describe('scored — the explicit "did this push get scored?" flag (daatan#1461)', () => {
    // news-indexer INFERS this from the payload shape: a `skipped` key, or every one of
    // stance/certainty/claim/probability/previousProbability/relevance null meaning "unscored,
    // retry" (news-indexer#293). The inference is a heuristic over six fields that a genuine,
    // recorded verdict can satisfy in full — an abstention on a forecast with no prior
    // confidence, whose trigger article the Oracle dropped, is all-null and gets retried
    // anyway. The field says it outright instead.
    it('is true when the Oracle produced an estimate and it was stored', async () => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

      const body = await (await POST(post('test-secret'))).json()

      expect(body.scored).toBe(true)
      expect(body.probability).not.toBeNull()
    })

    it('is true on an ABSTENTION — the all-null payload that used to read as "unscored"', async () => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)
      vi.mocked(recomputeFromPool).mockResolvedValue({
        mean: 0, std: 0, ciLow: 0, ciHigh: 0, articlesUsed: 0, settled: false,
        insufficientData: true, reason: 'all_articles_off_topic',
        poolSize: 3, usableSize: 0, excludedCount: 0, incompleteCount: 3, usableArticles: [],
        evidenceMass: null, nEff: null, ageAdjustedMass: null,
      })

      const body = await (await POST(post('test-secret'))).json()

      // No number was published, which is the half of the shape ni keys on — yet the push
      // WAS scored, and re-pushing the same articles would produce the same abstention.
      expect(body.probability).toBeNull()
      expect(body.scored).toBe(true)
    })

    it('is false when the Oracle returned nothing — the case that IS worth retrying', async () => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null } as never)

      const body = await (await POST(post('test-secret'))).json()

      expect(body.scored).toBe(false)
    })

    it('is false when the write dedupped to nothing stored', async () => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)
      vi.mocked(saveNewsIndexerMatch).mockResolvedValue({ stored: false, contextSnapshotId: 'snap-1' })

      const body = await (await POST(post('test-secret'))).json()

      expect(body.scored).toBe(false)
    })

    it('is false on the claim-gate short-circuit, alongside the existing `skipped` key', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([{ result: 'skip_complete', articleId: 'row-1' }])

      const body = await (await POST(post('test-secret'))).json()

      expect(body).toMatchObject({ skipped: 'already_complete', scored: false })
    })
  })

  describe('extraction claim gate (evidence-pool.ts) — fixes the confirmed near-instant duplicate-write race', () => {
    it('skips the Oracle call entirely when every article is already claimed/unchanged', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([{ result: 'skip_complete', articleId: 'row-1' }])

      const res = await POST(post('test-secret'))
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(getOracleForecast).not.toHaveBeenCalled()
      expect(saveNewsIndexerMatch).not.toHaveBeenCalled()
      expect(notifyNewsArticleMatched).not.toHaveBeenCalled()
      expect(body).toMatchObject({ ok: true, probability: null, skipped: 'already_complete' })
    })

    it('skips the Oracle call with `skipped: "in_flight"` when the only skip is still resolving', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([{ result: 'skip_pending', articleId: 'row-1' }])

      const body = await (await POST(post('test-secret'))).json()

      expect(getOracleForecast).not.toHaveBeenCalled()
      expect(body).toMatchObject({ ok: true, probability: null, skipped: 'in_flight' })
    })

    it('proceeds to call the Oracle when at least one article in a multi-article push is newly claimed', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([
      { result: 'skip_complete', articleId: 'row-1' },
      { result: 'claimed', articleId: 'row-2' },
    ])
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: ORACLE_WITH_SOURCE, logId: null } as never)

      const res = await POST(post('test-secret'))
      expect(res.status).toBe(200)
      expect(getOracleForecast).toHaveBeenCalledTimes(1)
    })

    it('only sends newly-claimed articles to the Oracle — an unchanged article must not be re-extracted (daatan#1172)', async () => {
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([
      { result: 'skip_complete', articleId: 'row-1' },
      { result: 'claimed', articleId: 'row-2' },
    ])
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
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([
      { result: 'claimed', articleId: 'row-1' },
      { result: 'claimed', articleId: 'row-2' },
    ])
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

    it('forwards the language hint to the Oracle alongside the body', async () => {
      // daatan#1290 / news-indexer#210. news-indexer knows the language per-source but never
      // sent it, so the Oracle stances raw Hebrew/Russian with English prompts. Inert at the
      // Oracle until retro#417 adds the field (its pydantic model ignores extras).
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_abstain' } as never)

      await POST(
        post('test-secret', {
          predictionId: 'pred-1',
          articles: [{ url: 'https://a.com/1', title: 'A', snippet: 's', text: 'גוף המאמר', language: 'he' }],
        }),
      )

      const sent = vi.mocked(getOracleForecast).mock.calls[0][1]!.articles!
      expect(sent[0].language).toBe('he')
      expect(sent[0].text).toBe('גוף המאמר')
    })

    it('accepts the language on the legacy single-article shape as articleLanguage', async () => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_abstain' } as never)

      await POST(post('test-secret', { ...VALID_BODY, articleLanguage: 'ru' }))

      expect(vi.mocked(getOracleForecast).mock.calls[0][1]!.articles![0].language).toBe('ru')
    })

    it('leaves the language undefined when none is sent', async () => {
      vi.mocked(getOracleForecast).mockResolvedValue({ forecast: null, logId: null, failureClass: 'oracle_abstain' } as never)

      await POST(post('test-secret'))

      expect(vi.mocked(getOracleForecast).mock.calls[0][1]!.articles![0].language).toBeUndefined()
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
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([
      { result: 'skip_complete', articleId: 'row-1' },
      { result: 'claimed', articleId: 'row-2' },
    ])
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
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([
      { result: 'skip_complete', articleId: 'row-1' },
      { result: 'claimed', articleId: 'row-2' },
    ])
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
      vi.mocked(claimArticlesForExtraction).mockResolvedValue([
      { result: 'skip_complete', articleId: 'row-1' },
      { result: 'claimed', articleId: 'row-2' },
    ])
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
