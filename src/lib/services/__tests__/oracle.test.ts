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
import { getOracleForecast, getOracleProbability, BOT_FORECAST_TIMEOUT_MS } from '../oracle'
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
