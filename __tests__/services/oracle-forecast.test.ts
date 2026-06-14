import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    ORACLE_URL: 'https://oracle.example.com' as string | undefined,
    ORACLE_API_KEY: 'test-key' as string | undefined,
  },
}))

vi.mock('@/env', () => ({ env: mockEnv }))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

// getOracleForecast fires logOracleCall() without awaiting it (telemetry is
// best-effort). The real implementation hits prisma; left unmocked it runs a DB
// write that outlives the test and settles during worker teardown, which trips
// vitest's "Closing rpc while onUserConsoleLog was pending" flake. Stub it to a
// resolved no-op so the test is hermetic. oracleFetch/getOracleConfig stay real.
vi.mock('@/lib/services/oracleClient', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/services/oracleClient')>()
  return { ...actual, logOracleCall: vi.fn().mockResolvedValue(undefined) }
})

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { getOracleForecast } from '@/lib/services/oracle'

function makeOracleResponse(overrides: Record<string, unknown> = {}) {
  return {
    question: 'Will X happen?',
    mean: 0.2,
    std: 0.1,
    ci_low: 0.0,
    ci_high: 0.4,
    articles_used: 3,
    sources: [],
    placeholder: false,
    ...overrides,
  }
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response
}

describe('getOracleForecast', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnv.ORACLE_URL = 'https://oracle.example.com'
    mockEnv.ORACLE_API_KEY = 'test-key'
    mockFetch.mockResolvedValue(okResponse(makeOracleResponse()))
  })

  it('returns null when oracle is not configured', async () => {
    mockEnv.ORACLE_URL = undefined
    mockEnv.ORACLE_API_KEY = undefined
    const result = await getOracleForecast('Will X happen?')
    expect(result).toBeNull()
  })

  it('sends articles in request body when provided', async () => {
    const articles = [
      { url: 'https://example.com/1', title: 'Article 1', snippet: 'Snippet 1', source: 'Reuters', publishedDate: '2026-01-01' },
      { url: 'https://example.com/2', title: 'Article 2', snippet: 'Snippet 2' },
    ]

    await getOracleForecast('Will X happen?', { articles })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.articles).toHaveLength(2)
    expect(body.articles[0].url).toBe('https://example.com/1')
    expect(body.articles[0].title).toBe('Article 1')
    expect(body.articles[1].url).toBe('https://example.com/2')
  })

  it('omits articles key from body when no articles provided', async () => {
    await getOracleForecast('Will X happen?')

    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.articles).toBeUndefined()
  })

  it('omits articles key from body when empty array provided', async () => {
    await getOracleForecast('Will X happen?', { articles: [] })

    const [, init] = mockFetch.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.articles).toBeUndefined()
  })

  it('returns null for placeholder response', async () => {
    mockFetch.mockResolvedValue(okResponse(makeOracleResponse({ placeholder: true })))

    const result = await getOracleForecast('Will X happen?')
    expect(result).toBeNull()
  })

  it('returns null when articles_used is 0', async () => {
    mockFetch.mockResolvedValue(okResponse(makeOracleResponse({ articles_used: 0 })))

    const result = await getOracleForecast('Will X happen?')
    expect(result).toBeNull()
  })

  it('returns null on non-OK HTTP status', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 } as Response)

    const result = await getOracleForecast('Will X happen?')
    expect(result).toBeNull()
  })

  it('returns null on fetch error (never throws)', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))

    const result = await getOracleForecast('Will X happen?')
    expect(result).toBeNull()
  })

  it('returns full forecast payload on success', async () => {
    const payload = makeOracleResponse({ mean: 0.4, articles_used: 5 })
    mockFetch.mockResolvedValue(okResponse(payload))

    const result = await getOracleForecast('Will X happen?')
    expect(result).not.toBeNull()
    expect(result!.mean).toBe(0.4)
    expect(result!.articles_used).toBe(5)
  })
})
