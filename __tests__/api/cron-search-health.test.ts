import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockGetOraculSearchHealth, mockNotifySearchHealthDigest } = vi.hoisted(() => ({
  mockGetOraculSearchHealth: vi.fn(),
  mockNotifySearchHealthDigest: vi.fn(),
}))

vi.mock('@/lib/services/oracleSearch', () => ({
  getOraculSearchHealth: (...args: unknown[]) => mockGetOraculSearchHealth(...args),
  SEARCH_LOW_CREDITS_THRESHOLD: 100,
}))

vi.mock('@/lib/services/telegram', () => ({
  notifySearchHealthDigest: (...args: unknown[]) => mockNotifySearchHealthDigest(...args),
}))

vi.mock('@/env', () => ({
  env: { BOT_RUNNER_SECRET: 'test-secret' },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const makeRequest = (secret?: string) =>
  new NextRequest('http://localhost/api/cron/search-health', {
    method: 'GET',
    headers: secret ? { 'x-cron-secret': secret } : {},
  })

describe('GET /api/cron/search-health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when secret is missing', async () => {
    const { GET } = await import('@/app/api/cron/search-health/route')
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 401 when secret is wrong', async () => {
    const { GET } = await import('@/app/api/cron/search-health/route')
    const res = await GET(makeRequest('wrong-secret'))
    expect(res.status).toBe(401)
  })

  it('returns ok with skipped=true when oracle not configured', async () => {
    mockGetOraculSearchHealth.mockResolvedValue(null)
    const { GET } = await import('@/app/api/cron/search-health/route')
    const res = await GET(makeRequest('test-secret'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.skipped).toBe(true)
    expect(mockNotifySearchHealthDigest).not.toHaveBeenCalled()
  })

  it('sends ONE grouped digest covering exhausted + low providers, skipping healthy/unconfigured', async () => {
    mockGetOraculSearchHealth.mockResolvedValue({
      overall: 'degraded',
      usable_count: 1,
      providers: {
        serper: { configured: true, exhausted: true, status: 'error' },
        brave: { configured: true, exhausted: false, status: 'ok', credits: 40 },
        serpapi: { configured: true, exhausted: false, status: 'ok', credits: 999 }, // healthy → excluded
        newsdata: { configured: false, exhausted: false, status: 'not_configured' }, // unconfigured → excluded
      },
    })
    const { GET } = await import('@/app/api/cron/search-health/route')
    await GET(makeRequest('test-secret'))

    expect(mockNotifySearchHealthDigest).toHaveBeenCalledTimes(1)
    expect(mockNotifySearchHealthDigest).toHaveBeenCalledWith({
      issues: [
        { provider: 'serper', kind: 'exhausted' },
        { provider: 'brave', kind: 'low', credits: 40 },
      ],
      overall: 'degraded',
      usableCount: 1,
    })
  })

  it('marks the digest critical (unhealthy) when no providers are usable', async () => {
    mockGetOraculSearchHealth.mockResolvedValue({
      overall: 'unhealthy',
      usable_count: 0,
      providers: {
        serper: { configured: true, exhausted: true, status: 'error' },
      },
    })
    const { GET } = await import('@/app/api/cron/search-health/route')
    await GET(makeRequest('test-secret'))

    expect(mockNotifySearchHealthDigest).toHaveBeenCalledTimes(1)
    const arg = mockNotifySearchHealthDigest.mock.calls[0][0]
    expect(arg.overall).toBe('unhealthy')
    expect(arg.usableCount).toBe(0)
  })

  it('still calls the digest (which no-ops) when all providers are healthy', async () => {
    mockGetOraculSearchHealth.mockResolvedValue({
      overall: 'healthy',
      usable_count: 2,
      providers: {
        serper: { configured: true, exhausted: false, status: 'ok', credits: 1000 },
        serpapi: { configured: true, exhausted: false, status: 'ok', credits: 2000 },
      },
    })
    const { GET } = await import('@/app/api/cron/search-health/route')
    const res = await GET(makeRequest('test-secret'))
    const data = await res.json()
    expect(data.alerts).toHaveLength(0)
    // The route always calls the digest; suppression of the empty/healthy case is the digest's own job.
    expect(mockNotifySearchHealthDigest).toHaveBeenCalledWith({
      issues: [],
      overall: 'healthy',
      usableCount: 2,
    })
  })
})
