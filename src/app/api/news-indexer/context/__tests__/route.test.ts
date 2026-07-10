/**
 * @jest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

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
})
