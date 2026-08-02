/**
 * @jest-environment node
 *
 * Unit tests for the TruthMachine Oracle client. All network calls to the
 * Oracle API are mocked with vi.stubGlobal('fetch', ...).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
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
import { getOracleForecast, getOracleProbability, getAuthorShadowLeaderboard, BOT_FORECAST_TIMEOUT_MS } from '../oracle'
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
      // The distinction that motivated the issue. FORECAST_TIMEOUT_MS is 12s against
      // retro's own 90s budget, so some share of what the pool recorded as "the
      // extractor produced nothing" never reached the extractor at all.
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

  it('defaults to the 12s timeout for interactive callers', async () => {
    await getOracleForecast('Q?')
    expect(timeoutSpy).toHaveBeenCalledWith(12_000)
  })

  it('uses a caller-supplied timeout when provided', async () => {
    await getOracleForecast('Q?', { timeoutMs: BOT_FORECAST_TIMEOUT_MS })
    expect(timeoutSpy).toHaveBeenCalledWith(BOT_FORECAST_TIMEOUT_MS)
    expect(BOT_FORECAST_TIMEOUT_MS).toBeGreaterThan(12_000)
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
