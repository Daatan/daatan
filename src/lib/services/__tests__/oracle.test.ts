/**
 * @jest-environment node
 *
 * Unit tests for the TruthMachine Oracle client. All network calls to the
 * Oracle API are mocked with vi.stubGlobal('fetch', ...).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// One shared logger object rather than a fresh one per createLogger() call, so
// the outcome_counts tests below can assert what was actually emitted. oracle.ts
// calls createLogger once at module load, so this is the very object it holds.
const { mockLog } = vi.hoisted(() => ({
  mockLog: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => mockLog,
}))

vi.mock('@/env', () => ({
  env: {
    ORACLE_URL: 'https://oracle.daatan.com',
    ORACLE_API_KEY: 'test-key',
  },
}))

// oracle.ts fires `void logOracleCall(...)` (fire-and-forget) on every path, and
// the real impl does an un-awaited Prisma write. Left unmocked it resolves after
// the test ends, spraying prisma:error to the console during worker teardown —
// a race that fails the run with EnvironmentTeardownError even though every test
// passes. No-op it, but keep oracleFetch/getOracleConfig real so the URL/header/
// timeout assertions below still exercise the actual client.
vi.mock('@/lib/services/oracleClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/oracleClient')>()
  return {
    ...actual,
    logOracleCall: vi.fn().mockResolvedValue('log-1'),
  }
})

import { ClaimDirection } from '@prisma/client'
import { getOracleForecast, getOracleProbability, getAuthorShadowLeaderboard, BOT_FORECAST_TIMEOUT_MS, FORECAST_TIMEOUT_MS, INTERACTIVE_FORECAST_TIMEOUT_MS } from '../oracle'
import { logOracleCall } from '@/lib/services/oracleClient'

const mockLogOracleCall = vi.mocked(logOracleCall)

const sampleSources = [
  {
    source_id: 'reuters',
    source_name: 'Reuters',
    url: 'https://reuters.com/a',
    stance: 0.6,
    certainty: 0.8,
    credibility_weight: 0.95,
    claims: ['Claim A', 'Claim B'],
  },
  {
    source_id: 'blog',
    source_name: 'Random Blog',
    url: 'https://blog.example.com/a',
    stance: -0.3,
    certainty: 0.4,
    credibility_weight: 0.2,
    claims: ['Claim C'],
  },
]

const fullPayload = {
  question: 'Will X happen?',
  mean: 0.3,
  std: 0.12,
  ci_low: 0.05,
  ci_high: 0.55,
  articles_used: 4,
  sources: sampleSources,
  placeholder: false,
}

describe('getOracleForecast', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the full payload on a successful response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => fullPayload,
    })

    const { forecast: data, logId } = await getOracleForecast('Will X happen?')
    expect(data).not.toBeNull()
    expect(data?.mean).toBe(0.3)
    expect(data?.ci_low).toBe(0.05)
    expect(data?.ci_high).toBe(0.55)
    expect(data?.articles_used).toBe(4)
    expect(data?.sources).toHaveLength(2)
    expect(data?.sources[0].source_name).toBe('Reuters')
    expect(logId).toBe('log-1')
  })

  it('threads the response token_usage into the call log (and omits it when absent)', async () => {
    const usage = { prompt_tokens: 1200, completion_tokens: 340, total_tokens: 1540, cache_read_tokens: 800, cache_write_tokens: 0 }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...fullPayload, token_usage: usage }),
    })
    await getOracleForecast('Q?')
    expect(mockLogOracleCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'OK', tokenUsage: usage }))

    mockLogOracleCall.mockClear()
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
    await getOracleForecast('Q?')
    expect(mockLogOracleCall).toHaveBeenCalledWith(expect.objectContaining({ tokenUsage: undefined }))
  })

  it('sends the x-api-key header and posts to /forecast', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
    await getOracleForecast('Q?')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://oracle.daatan.com/forecast')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('test-key')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('maps supplied articles to the Oracle snake_case `published_date`', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
    await getOracleForecast('Q?', {
      articles: [
        { url: 'https://x.com/a', title: 'T', snippet: 'S', source: 'X', publishedDate: '2026-06-14' },
      ],
    })
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.articles[0].published_date).toBe('2026-06-14')
    // the camelCase key must not leak through to the Oracle
    expect(body.articles[0].publishedDate).toBeUndefined()
  })

  it('threads the supplied gatekeeper verdict to the Oracle (both fields, snake_case)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
    await getOracleForecast('Q?', {
      articles: [
        { url: 'https://x.com/a', title: 'T', snippet: 'S', relevance: 0.83, isPrediction: true },
      ],
    })
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.articles[0].relevance).toBe(0.83)
    expect(body.articles[0].is_prediction).toBe(true)
    // the camelCase key must not leak through to the Oracle
    expect(body.articles[0].isPrediction).toBeUndefined()
  })

  it('omits the verdict when absent or incomplete (both-or-neither)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
    await getOracleForecast('Q?', {
      articles: [
        { url: 'https://x.com/a', title: 'T', snippet: 'S' },                 // no verdict
        { url: 'https://x.com/b', title: 'T', snippet: 'S', relevance: 0.7 }, // partial -> omit both
      ],
    })
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.articles[0].relevance).toBeUndefined()
    expect(body.articles[0].is_prediction).toBeUndefined()
    expect(body.articles[1].relevance).toBeUndefined()
    expect(body.articles[1].is_prediction).toBeUndefined()
  })

  it('returns null when the response is a placeholder', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...fullPayload, placeholder: true, reason: 'no_search_results' }),
    })
    const { forecast } = await getOracleForecast('Q?')
    expect(forecast).toBeNull()
    expect(mockLogOracleCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'EMPTY', failureReason: 'no_search_results' }))
  })

  it('flags insufficientData (and returns null) when the Oracle abstains', async () => {
    // _empty_response carries insufficient_data:true (and placeholder:true); the
    // abstention check runs first so the caller can distinguish "no evidence bears
    // on the claim" from "Oracle unavailable" and avoid an ungrounded LLM guess.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...fullPayload, mean: 0, articles_used: 0, placeholder: true, insufficient_data: true, reason: 'all_low_certainty' }),
    })
    const { forecast, insufficientData } = await getOracleForecast('Q?')
    expect(forecast).toBeNull()
    expect(insufficientData).toBe(true)
    expect(mockLogOracleCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'EMPTY', failureReason: 'all_low_certainty' }))
  })

  it('returns null when articles_used is 0, passing through the Oracle reason', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...fullPayload, articles_used: 0, reason: 'all_articles_off_topic' }),
    })
    const { forecast } = await getOracleForecast('Q?')
    expect(forecast).toBeNull()
    expect(mockLogOracleCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'EMPTY', failureReason: 'all_articles_off_topic' }))
  })

  it('renames the Oracle internal timeout reason to oracle_timeout', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...fullPayload, articles_used: 0, reason: 'timeout' }),
    })
    await getOracleForecast('Q?')
    expect(mockLogOracleCall).toHaveBeenCalledWith(expect.objectContaining({ failureReason: 'oracle_timeout' }))
  })

  it('classifies a non-OK 5xx status as http_5xx', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}), text: async () => '' })
    const { forecast } = await getOracleForecast('Q?')
    expect(forecast).toBeNull()
    expect(mockLogOracleCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'ERROR', failureReason: 'http_5xx' }))
  })

  it('classifies a thrown TimeoutError as a timeout failure', async () => {
    const err = new Error('aborted')
    err.name = 'TimeoutError'
    fetchMock.mockRejectedValueOnce(err)
    const { forecast } = await getOracleForecast('Q?')
    expect(forecast).toBeNull()
    expect(mockLogOracleCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'ERROR', failureReason: 'timeout' }))
  })

  it('classifies a generic thrown error as a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    await getOracleForecast('Q?')
    expect(mockLogOracleCall).toHaveBeenCalledWith(expect.objectContaining({ failureReason: 'network' }))
  })

  describe('failureClass — why the forecast is null (daatan#1231)', () => {
    // `getOracleForecast` returns null for six different reasons and used to say which
    // only in OracleCallLog, which the evidence-pool retry sweep never reads. So a 12s
    // client timeout and a deliberate all-articles-off-topic abstention wrote BYTE-
    // IDENTICAL pool rows, both stamped `oracle_null` — 73% of the 200 most recent
    // fetches on 2026-07-31. These pin one class per branch: the whole value of the
    // change is that no two of them collide.

    it('classifies a deliberate abstention as oracle_abstain', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...fullPayload, mean: 0, articles_used: 0, placeholder: true, insufficient_data: true, reason: 'all_low_certainty' }),
      })
      const { failureClass, insufficientData } = await getOracleForecast('Q?')
      expect(failureClass).toBe('oracle_abstain')
      expect(insufficientData).toBe(true)
    })

    it('classifies a client timeout as oracle_timeout — NOT an abstention', async () => {
      // The distinction that motivated the issue: some share of what the pool recorded
      // as "the extractor produced nothing" never reached the extractor at all. The
      // budget was 12s against a server whose p99 is 25s (daatan#1254, now 30s) — the
      // class stays load-bearing because a timeout still says nothing about the article.
      const err = new Error('aborted')
      err.name = 'TimeoutError'
      fetchMock.mockRejectedValueOnce(err)
      const { failureClass } = await getOracleForecast('Q?')
      expect(failureClass).toBe('oracle_timeout')
    })

    it('classifies a generic transport error as oracle_network', async () => {
      fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      const { failureClass } = await getOracleForecast('Q?')
      expect(failureClass).toBe('oracle_network')
    })

    it('classifies a non-OK status as oracle_http', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}), text: async () => '' })
      const { failureClass } = await getOracleForecast('Q?')
      expect(failureClass).toBe('oracle_http')
    })

    it('classifies a placeholder response as oracle_placeholder', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...fullPayload, placeholder: true, reason: 'no_search_results' }),
      })
      const { failureClass } = await getOracleForecast('Q?')
      expect(failureClass).toBe('oracle_placeholder')
    })

    it('classifies zero usable articles as oracle_no_articles', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...fullPayload, articles_used: 0, reason: 'all_articles_off_topic' }),
      })
      const { failureClass } = await getOracleForecast('Q?')
      expect(failureClass).toBe('oracle_no_articles')
    })

    it('leaves failureClass undefined on a successful forecast', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
      const { forecast, failureClass } = await getOracleForecast('Q?')
      expect(forecast).not.toBeNull()
      expect(failureClass).toBeUndefined()
    })

    it('never rejects — the invariant that makes callers\' catch blocks dead code', async () => {
      // Two callers wrapped this in a try/catch that stamped `extractor_error`, and both
      // were unreachable: `getOracleConfig` is a pure env read, every network and parse
      // path is inside this function's own try, and the catch's single await
      // (`logOracleCall`) swallows its own errors. Those branches are removed
      // (daatan#1231) — which is only safe while this stays true, so pin it here rather
      // than leaving it as a comment. A future `await` added outside the try would break
      // it silently: claims would be left PENDING for the full staleness window.
      fetchMock.mockRejectedValueOnce(new Error('boom'))
      await expect(getOracleForecast('Q?')).resolves.toMatchObject({ forecast: null })

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('Unexpected token < in JSON') },
      })
      await expect(getOracleForecast('Q?')).resolves.toMatchObject({ forecast: null })

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => { throw new Error('unreadable body') },
      })
      await expect(getOracleForecast('Q?')).resolves.toMatchObject({ forecast: null })
    })

    it('every null branch sets a class — none may fall through to the residual', async () => {
      // The property that makes the split worth having. If any branch forgot its class,
      // the caller's `?? 'oracle_null'` would quietly recreate the original bug for that
      // one cause, and it would look fixed everywhere else.
      const timeoutErr = new Error('aborted')
      timeoutErr.name = 'TimeoutError'
      const nullResponses = [
        { ok: false, status: 502, json: async () => ({}), text: async () => '' },
        { ok: true, status: 200, json: async () => ({ ...fullPayload, placeholder: true, reason: 'x' }) },
        { ok: true, status: 200, json: async () => ({ ...fullPayload, articles_used: 0, reason: 'x' }) },
        { ok: true, status: 200, json: async () => ({ ...fullPayload, articles_used: 0, insufficient_data: true, reason: 'x' }) },
      ]
      for (const res of nullResponses) {
        fetchMock.mockResolvedValueOnce(res)
        const { forecast, failureClass } = await getOracleForecast('Q?')
        expect(forecast).toBeNull()
        expect(failureClass).toBeDefined()
      }
      fetchMock.mockRejectedValueOnce(timeoutErr)
      expect((await getOracleForecast('Q?')).failureClass).toBeDefined()
    })
  })

  describe('outcome_counts — per-article stage histogram (daatan#1457)', () => {
    // retro has always sent this; daatan parsed it nowhere, so nothing recorded
    // WHICH stage killed an article when a pool came back thin.
    const counts = { ok: 2, gate_rejected: 6, empty_text: 1, extract_error: 1 }

    beforeEach(() => {
      mockLog.info.mockClear()
    })

    /** The payload of the single `log.info` the call emitted. */
    const lastInfoPayload = () => mockLog.info.mock.calls.at(-1)?.[0] as Record<string, unknown>

    it('surfaces the histogram on a successful forecast', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...fullPayload, outcome_counts: counts }),
      })

      const result = await getOracleForecast('Q?', {}, { source: 'news-indexer', predictionId: 'pred-1' })
      expect(result.forecast?.outcome_counts).toEqual(counts)
      expect(result.outcomeCounts).toEqual(counts)
      // Yield is only computable when a success also reports the histogram: this
      // forecast stood on 2 of 10 candidates, which is the interesting case.
      expect(lastInfoPayload()).toMatchObject({ outcomeCounts: counts, predictionId: 'pred-1', source: 'news-indexer' })
    })

    it.each([
      ['abstain', { mean: 0, articles_used: 0, insufficient_data: true, reason: 'no_usable_predictions' }],
      ['placeholder', { placeholder: true, reason: 'no_search_results' }],
      ['no usable articles', { mean: 0, articles_used: 0, reason: 'all_fetches_failed' }],
    ])('surfaces the histogram on the %s path, where forecast is null', async (_label, overrides) => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...fullPayload, ...overrides, outcome_counts: counts }),
      })

      const result = await getOracleForecast('Q?', {}, { source: 'news-indexer', predictionId: 'pred-1' })
      expect(result.forecast).toBeNull()
      // The whole point: these are the runs whose yield needs explaining, and
      // `forecast` is null on all of them, so the histogram has to ride on the
      // result rather than only inside the (discarded) response.
      expect(result.outcomeCounts).toEqual(counts)
    })

    it.each([
      ['abstain', { mean: 0, articles_used: 0, insufficient_data: true, reason: 'no_usable_predictions' }],
      ['placeholder', { placeholder: true, reason: 'no_search_results' }],
      ['no usable articles', { mean: 0, articles_used: 0, reason: 'all_fetches_failed' }],
    ])('logs the %s path at INFO, not DEBUG — prod never emits debug', async (_label, overrides) => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...fullPayload, ...overrides, outcome_counts: counts }),
      })

      await getOracleForecast('Q?', {}, { source: 'news-indexer', predictionId: 'pred-1' })
      // A debug-only histogram is parsed and then dropped on the one deployment
      // that needs it: pino runs at level `info` in production.
      expect(mockLog.info).toHaveBeenCalledTimes(1)
      expect(lastInfoPayload()).toMatchObject({ outcomeCounts: counts, predictionId: 'pred-1' })
    })

    it.each([
      ['omitted', undefined],
      ['empty', {}],
    ])('reports an %s histogram as null rather than an empty object', async (_label, outcome_counts) => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ...fullPayload, ...(outcome_counts ? { outcome_counts } : {}) }),
      })

      // `{}` is not "zero articles at every stage" — it's indistinguishable from
      // a retro build too old to send the field, so it must not read as data.
      const result = await getOracleForecast('Q?')
      expect(result.outcomeCounts).toBeNull()
      expect(lastInfoPayload().outcomeCounts).toBeNull()
    })

    it('leaves the histogram null when the request never reached retro', async () => {
      const timeoutErr = new Error('aborted')
      timeoutErr.name = 'TimeoutError'
      fetchMock.mockRejectedValueOnce(timeoutErr)

      const result = await getOracleForecast('Q?')
      expect(result.failureClass).toBe('oracle_timeout')
      expect(result.outcomeCounts ?? null).toBeNull()
    })
  })

  describe('claim direction/deadline (retro #244 direction guard)', () => {
    it('sends claim_direction: "arrival" for ClaimDirection.ARRIVAL', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
      await getOracleForecast('Q?', { claimDirection: ClaimDirection.ARRIVAL })
      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(init.body as string)
      expect(body.claim_direction).toBe('arrival')
    })

    it('sends claim_direction: "survival" for ClaimDirection.SURVIVAL', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
      await getOracleForecast('Q?', { claimDirection: ClaimDirection.SURVIVAL })
      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(init.body as string)
      expect(body.claim_direction).toBe('survival')
    })

    it('omits claim_direction for ClaimDirection.NONE (retro 422s on the literal string "none")', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
      await getOracleForecast('Q?', { claimDirection: ClaimDirection.NONE })
      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(init.body as string)
      expect(body.claim_direction).toBeUndefined()
      expect('claim_direction' in body).toBe(false)
    })

    it('omits claim_direction when null/undefined', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
      await getOracleForecast('Q?', { claimDirection: null })
      const [, init] = fetchMock.mock.calls[0]
      expect('claim_direction' in JSON.parse(init.body as string)).toBe(false)

      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
      await getOracleForecast('Q?')
      const [, init2] = fetchMock.mock.calls[1]
      expect('claim_direction' in JSON.parse(init2.body as string)).toBe(false)
    })

    it('sends claim_deadline as an ISO string when present', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
      await getOracleForecast('Q?', { claimDeadline: new Date('2026-12-31T00:00:00.000Z') })
      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(init.body as string)
      expect(body.claim_deadline).toBe('2026-12-31T00:00:00.000Z')
    })

    it('omits claim_deadline when null/undefined', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
      await getOracleForecast('Q?', { claimDeadline: null })
      const [, init] = fetchMock.mock.calls[0]
      expect('claim_deadline' in JSON.parse(init.body as string)).toBe(false)
    })
  })

  describe('resolution_criteria (retro #353 / daatan#1375)', () => {
    it('sends resolution_criteria when the claim has resolution rules', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
      await getOracleForecast('Q?', { resolutionRules: 'Only an official government announcement counts.' })
      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(init.body as string)
      expect(body.resolution_criteria).toBe('Only an official government announcement counts.')
    })

    it('omits resolution_criteria when null, undefined or empty', async () => {
      // Omitting rather than defaulting is what keeps retro's cache key (retro#510)
      // separating rules-bearing from rules-less traffic. Sending '' would make every
      // rules-less caller hash as if it had sent rules.
      for (const rules of [null, undefined, '']) {
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
        await getOracleForecast('Q?', { resolutionRules: rules })
      }
      for (const [, init] of fetchMock.mock.calls) {
        expect('resolution_criteria' in JSON.parse(init.body as string)).toBe(false)
      }
    })
  })

  describe('prediction_id (retro #273 log correlation)', () => {
    it('sends prediction_id when meta.predictionId is set', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
      await getOracleForecast('Q?', undefined, { source: 'news-indexer', predictionId: 'pred-123' })
      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(init.body as string)
      expect(body.prediction_id).toBe('pred-123')
    })

    it('omits prediction_id when meta.predictionId is absent', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
      await getOracleForecast('Q?')
      const [, init] = fetchMock.mock.calls[0]
      expect('prediction_id' in JSON.parse(init.body as string)).toBe(false)
    })
  })
})

describe('getOracleProbability', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('scales mean from [-1, 1] to [0, 1]', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ...fullPayload, mean: 0.3 }),
    })
    const prob = await getOracleProbability('Q?')
    expect(prob).toBeCloseTo(0.65, 5)
  })

  it('returns null when the full forecast is unavailable', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    expect(await getOracleProbability('Q?')).toBeNull()
  })

  it('forwards resolutionRules through to the request body', async () => {
    // This wrapper enumerates the ClaimMeta fields it forwards rather than spreading,
    // so a field added to ClaimMeta reaches getOracleForecast but silently stops here.
    // bots/voting is the only caller and it needs the rules in the cache key.
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fullPayload })
    await getOracleProbability('Q?', { source: 'bot-voting' }, { resolutionRules: 'Official announcement only.' })
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body as string).resolution_criteria).toBe('Official announcement only.')
  })
})

describe('forecast request timeout', () => {
  const fetchMock = vi.fn()
  let timeoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => fullPayload })
    vi.stubGlobal('fetch', fetchMock)
    timeoutSpy = vi.spyOn(AbortSignal, 'timeout') // default impl returns a real signal
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    timeoutSpy.mockRestore()
  })

  it('defaults to the 30s background budget, not the interactive one', async () => {
    // daatan#1254. The default serves the server-to-server callers (news-indexer push,
    // oracle-backfill sweep); retro's p99 on that path is 25.0s, so the old 12s default
    // discarded 15.3% of forecasts it had already paid for. The default is deliberately
    // the LONG one: a new background caller silently censoring completed work is worse
    // than a new interactive caller waiting too long.
    await getOracleForecast('Q?')
    expect(timeoutSpy).toHaveBeenCalledWith(30_000)
  })

  it('keeps the background budget above the measured retro ceiling', () => {
    // retro's per_article_timeout_seconds=25 is the real clamp (its declared
    // forecast_timeout_seconds=90 fired once in 93 days). A background budget at or
    // below 25s re-introduces the censoring this issue fixed.
    const RETRO_MEASURED_CEILING_MS = 25_000
    expect(FORECAST_TIMEOUT_MS).toBeGreaterThan(RETRO_MEASURED_CEILING_MS)
    // The two short budgets are deliberate opt-outs, both raced against a caller-side
    // wall clock. Ordering them here pins the intent: interactive < bot < background.
    expect(INTERACTIVE_FORECAST_TIMEOUT_MS).toBeLessThan(BOT_FORECAST_TIMEOUT_MS)
    expect(BOT_FORECAST_TIMEOUT_MS).toBeLessThan(FORECAST_TIMEOUT_MS)
  })

  it('interactive callers fit inside the 15s estimation race they run under', async () => {
    // forecasts/[id]/context races the whole estimation at ESTIMATION_TIMEOUT_MS=15s.
    // An Oracle budget above that is abandoned one level up while still running — the
    // same inversion, one hop further in. Keep them consistent.
    const ESTIMATION_TIMEOUT_MS = 15_000
    expect(INTERACTIVE_FORECAST_TIMEOUT_MS).toBeLessThan(ESTIMATION_TIMEOUT_MS)
    await getOracleForecast('Q?', { timeoutMs: INTERACTIVE_FORECAST_TIMEOUT_MS })
    expect(timeoutSpy).toHaveBeenCalledWith(INTERACTIVE_FORECAST_TIMEOUT_MS)
  })

  it('uses a caller-supplied timeout when provided', async () => {
    await getOracleForecast('Q?', { timeoutMs: BOT_FORECAST_TIMEOUT_MS })
    expect(timeoutSpy).toHaveBeenCalledWith(BOT_FORECAST_TIMEOUT_MS)
    expect(BOT_FORECAST_TIMEOUT_MS).toBeGreaterThan(INTERACTIVE_FORECAST_TIMEOUT_MS)
  })

  it('getOracleProbability forwards its timeout option to the request', async () => {
    await getOracleProbability('Q?', { source: 'bot-voting' }, { timeoutMs: BOT_FORECAST_TIMEOUT_MS })
    expect(timeoutSpy).toHaveBeenCalledWith(BOT_FORECAST_TIMEOUT_MS)
  })

  it('getOracleProbability forwards claimDirection/claimDeadline to the request', async () => {
    await getOracleProbability(
      'Q?',
      { source: 'bot-voting' },
      { claimDirection: ClaimDirection.SURVIVAL, claimDeadline: new Date('2026-06-01T00:00:00.000Z') },
    )
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.claim_direction).toBe('survival')
    expect(body.claim_deadline).toBe('2026-06-01T00:00:00.000Z')
  })
})

describe('getAuthorShadowLeaderboard', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    mockLogOracleCall.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const samplePayload = {
    authors: [
      {
        id: 'Ben Caspit — maariv',
        author: 'Ben Caspit',
        outlet_name: 'maariv',
        brier_score: 0.49,
        skill_mu: 25.0,
        skill_sigma: 8.33,
        skill_conservative: 0.01,
        predictions: 1,
        articles: 3,
      },
    ],
    count: 1,
  }

  it('returns the payload on a successful response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => samplePayload })
    const data = await getAuthorShadowLeaderboard()
    expect(data).toEqual(samplePayload)
    expect(fetchMock.mock.calls[0][0]).toBe('https://oracle.daatan.com/leaderboard/author-shadow')
    expect(mockLogOracleCall).toHaveBeenCalledWith(expect.objectContaining({ callType: 'LEADERBOARD', status: 'OK', resultCount: 1 }))
  })

  it('returns null and logs ERROR on a non-OK status', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
    const data = await getAuthorShadowLeaderboard()
    expect(data).toBeNull()
    expect(mockLogOracleCall).toHaveBeenCalledWith(expect.objectContaining({ callType: 'LEADERBOARD', status: 'ERROR', httpStatus: 503 }))
  })

  it('returns null and logs ERROR when the request throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    const data = await getAuthorShadowLeaderboard()
    expect(data).toBeNull()
    expect(mockLogOracleCall).toHaveBeenCalledWith(expect.objectContaining({ callType: 'LEADERBOARD', status: 'ERROR' }))
  })
})
