import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockNotifyDailySummary,
  mockGetOraculSearchHealth,
  mockUserCount,
  mockPredictionCount,
  mockCommitmentCount,
} = vi.hoisted(() => ({
  mockNotifyDailySummary: vi.fn(),
  mockGetOraculSearchHealth: vi.fn(),
  mockUserCount: vi.fn(),
  mockPredictionCount: vi.fn(),
  mockCommitmentCount: vi.fn(),
}))

vi.mock('@/lib/services/telegram', () => ({
  notifyDailySummary: (...args: unknown[]) => mockNotifyDailySummary(...args),
}))

vi.mock('@/lib/services/oracleSearch', () => ({
  getOraculSearchHealth: (...args: unknown[]) => mockGetOraculSearchHealth(...args),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { count: (...a: unknown[]) => mockUserCount(...a) },
    prediction: { count: (...a: unknown[]) => mockPredictionCount(...a) },
    commitment: { count: (...a: unknown[]) => mockCommitmentCount(...a) },
  },
}))

vi.mock('@/env', () => ({
  env: { BOT_RUNNER_SECRET: 'test-secret', NEXT_PUBLIC_APP_VERSION: '9.9.9' },
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

const makeRequest = (secret?: string) =>
  new NextRequest('http://localhost/api/cron/heartbeat', {
    method: 'GET',
    headers: secret ? { 'x-cron-secret': secret } : {},
  })

describe('GET /api/cron/heartbeat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when secret is missing or wrong', async () => {
    const { GET } = await import('@/app/api/cron/heartbeat/route')
    expect((await GET(makeRequest())).status).toBe(401)
    expect((await GET(makeRequest('nope'))).status).toBe(401)
  })

  it('sends a daily summary with aggregated 24h counts and provider health', async () => {
    mockUserCount.mockResolvedValue(3)
    // prediction.count is used twice (published, resolutions) — order matters
    mockPredictionCount.mockResolvedValueOnce(5).mockResolvedValueOnce(2)
    mockCommitmentCount.mockResolvedValue(12)
    mockGetOraculSearchHealth.mockResolvedValue({
      overall: 'degraded',
      usable_count: 4,
      providers: { a: {}, b: {}, c: {}, d: {}, e: {}, f: {} },
    })

    const { GET } = await import('@/app/api/cron/heartbeat/route')
    const res = await GET(makeRequest('test-secret'))

    expect(res.status).toBe(200)
    expect(mockNotifyDailySummary).toHaveBeenCalledTimes(1)
    expect(mockNotifyDailySummary).toHaveBeenCalledWith({
      version: '9.9.9',
      newUsers: 3,
      published: 5,
      commitments: 12,
      resolutions: 2,
      search: { usable: 4, total: 6 },
    })
  })

  it('passes search:null when oracle health is unavailable', async () => {
    mockUserCount.mockResolvedValue(0)
    mockPredictionCount.mockResolvedValue(0)
    mockCommitmentCount.mockResolvedValue(0)
    mockGetOraculSearchHealth.mockResolvedValue(null)

    const { GET } = await import('@/app/api/cron/heartbeat/route')
    await GET(makeRequest('test-secret'))

    expect(mockNotifyDailySummary).toHaveBeenCalledWith(
      expect.objectContaining({ search: null }),
    )
  })
})
